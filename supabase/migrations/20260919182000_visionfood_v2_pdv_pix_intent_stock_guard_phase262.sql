-- VisionFood V2 PHASE 262
-- Fix only public.pdv_create_pix_intent_v2(text,uuid,jsonb,text).
-- Keep anon exposure intentional behind the opaque PDV session token.
-- Prevent generating a PIX payment intent for a cart that cannot currently be
-- fulfilled by direct product stock or recipe ingredient stock.

CREATE OR REPLACE FUNCTION public.pdv_create_pix_intent_v2(
  _session_token text,
  _caixa_id uuid,
  _items jsonb,
  _cupom_code text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  s public.pdv_sessions%rowtype;
  c public.caixas_pdv%rowtype;
  h text;
  item jsonb;
  p public.products%rowtype;
  qty integer;
  subtotal numeric := 0;
  discount numeric := 0;
  final_total numeric := 0;
  coupon public.cupons%rowtype;
  code text := upper(btrim(coalesce(_cupom_code, '')));
  iid uuid;
  canonical_items jsonb := '[]'::jsonb;
  ts timestamptz := now();
  insufficient_stock boolean := false;
BEGIN
  h := encode(
    extensions.digest(coalesce(_session_token, ''), 'sha256'),
    'hex'
  );

  SELECT *
    INTO s
    FROM public.pdv_sessions
   WHERE token_hash = h
     AND revoked_at IS NULL
     AND expires_at > now();

  IF s.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session');
  END IF;

  SELECT *
    INTO c
    FROM public.caixas_pdv
   WHERE id = _caixa_id
     AND organization_id = s.organization_id
     AND operador_id = s.operador_id
     AND status IN ('open', 'aberto');

  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_cash_register');
  END IF;

  IF jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_sale');
  END IF;

  FOR item IN
    SELECT value
      FROM jsonb_array_elements(_items)
  LOOP
    BEGIN
      qty := (item->>'quantity')::integer;
    EXCEPTION
      WHEN others THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
    END;

    IF qty IS NULL OR qty <= 0 OR qty > 999 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
    END IF;

    BEGIN
      SELECT *
        INTO p
        FROM public.products
       WHERE id = (item->>'product_id')::uuid
         AND organization_id = s.organization_id
         AND coalesce(available, true) = true
         AND coalesce(ingredient_stock_blocked, false) = false;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_product_id');
    END;

    IF p.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'product_not_found');
    END IF;

    subtotal := subtotal + (p.price * qty);

    canonical_items := canonical_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'price', p.price,
        'quantity', qty
      )
    );
  END LOOP;

  -- Validate direct product stock against the total quantity requested per
  -- product, so duplicated cart lines cannot bypass stock checks.
  SELECT EXISTS (
    SELECT 1
      FROM (
        SELECT
          (x->>'product_id')::uuid AS product_id,
          sum((x->>'quantity')::numeric) AS requested_qty
        FROM jsonb_array_elements(canonical_items) AS x
        GROUP BY (x->>'product_id')::uuid
      ) requested
      JOIN public.products p2
        ON p2.id = requested.product_id
       AND p2.organization_id = s.organization_id
     WHERE coalesce(p2.manage_stock, false) = true
       AND coalesce(p2.stock_quantity, 0) < requested.requested_qty
  )
  INTO insufficient_stock;

  IF insufficient_stock THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_stock');
  END IF;

  -- Validate recipe ingredient stock for the full cart. Requirements are
  -- aggregated by ingredient, covering duplicate product lines and different
  -- products that consume the same ingredient.
  SELECT EXISTS (
    SELECT 1
      FROM (
        SELECT
          coalesce(r.ingrediente_id, r.ingredient_id) AS ingredient_id,
          sum(
            greatest(coalesce(r.quantidade, 0), 0)
            * requested.requested_qty
          ) AS required_qty
        FROM (
          SELECT
            (x->>'product_id')::uuid AS product_id,
            sum((x->>'quantity')::numeric) AS requested_qty
          FROM jsonb_array_elements(canonical_items) AS x
          GROUP BY (x->>'product_id')::uuid
        ) requested
        JOIN public.receitas r
          ON r.organization_id = s.organization_id
         AND coalesce(r.product_id, r.produto_id) = requested.product_id
       WHERE coalesce(r.ingrediente_id, r.ingredient_id) IS NOT NULL
         AND greatest(coalesce(r.quantidade, 0), 0) > 0
       GROUP BY coalesce(r.ingrediente_id, r.ingredient_id)
      ) required
      JOIN public.ingredientes i
        ON i.id = required.ingredient_id
       AND i.organization_id = s.organization_id
     WHERE coalesce(i.estoque_atual, 0) < required.required_qty
  )
  INTO insufficient_stock;

  IF insufficient_stock THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'insufficient_ingredient_stock'
    );
  END IF;

  IF code <> '' THEN
    SELECT *
      INTO coupon
      FROM public.cupons
     WHERE organization_id = s.organization_id
       AND upper(codigo) = code
       AND ativo = true
       AND coalesce(status, true) = true
       AND (validade IS NULL OR validade >= ts)
       AND (data_inicio IS NULL OR data_inicio <= ts)
       AND (data_fim IS NULL OR data_fim >= ts)
     LIMIT 1;

    IF coupon.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_coupon');
    END IF;

    IF subtotal < coalesce(coupon.minimo_pedido, 0) THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'coupon_minimum_not_met'
      );
    END IF;

    IF lower(coalesce(coupon.tipo_desconto, coupon.tipo, ''))
       IN ('percentual', 'porcentagem', 'percent', 'percentage') THEN
      discount := round(
        subtotal * greatest(0, least(coupon.valor, 100)) / 100,
        2
      );
    ELSE
      discount := least(subtotal, greatest(0, coupon.valor));
    END IF;
  END IF;

  final_total := greatest(0, subtotal - discount);

  IF final_total <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_total');
  END IF;

  INSERT INTO public.pdv_pix_intents(
    organization_id,
    session_id,
    operador_id,
    caixa_id,
    items,
    cupom_code,
    amount
  )
  VALUES(
    s.organization_id,
    s.id,
    s.operador_id,
    c.id,
    canonical_items,
    code,
    final_total
  )
  RETURNING id INTO iid;

  UPDATE public.pdv_sessions
     SET last_seen_at = now()
   WHERE id = s.id;

  RETURN jsonb_build_object(
    'ok', true,
    'intent_id', iid,
    'amount', final_total,
    'expires_in_seconds', 900
  );
END
$function$;

REVOKE ALL ON FUNCTION public.pdv_create_pix_intent_v2(text,uuid,jsonb,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_create_pix_intent_v2(text,uuid,jsonb,text)
  TO anon, authenticated, service_role;
