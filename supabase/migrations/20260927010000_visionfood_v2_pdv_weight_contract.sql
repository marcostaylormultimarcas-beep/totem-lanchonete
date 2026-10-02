-- VisionFood V2 — PDV weighted-product contract.
-- Function-only additive migration; no table/schema changes.
-- products.sold_by_weight identifies weighted products and products.price is authoritative R$/kg.
-- pdv_registrar_venda_pix_v2 remains unchanged because it already persists and returns pdv_pix_intents.items.

-- VisionFood V2 PHASE 261
-- Fix only public.pdv_catalog_v2(text).
-- Keep anon exposure intentional behind the opaque PDV session token while aligning
-- PDV product availability with the authoritative stock availability contract.

CREATE OR REPLACE FUNCTION public.pdv_catalog_v2(_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  s public.pdv_sessions%rowtype;
  h text;
  payload jsonb;
BEGIN
  h := encode(extensions.digest(coalesce(_session_token,''), 'sha256'), 'hex');

  SELECT *
    INTO s
    FROM public.pdv_sessions
   WHERE token_hash = h
     AND revoked_at IS NULL
     AND expires_at > now();

  IF s.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'price', p.price,
        'codigo_barras', p.codigo_barras,
        'available', p.available,
        'image', p.image,
        'sold_by_weight', p.sold_by_weight,
        'price_per_kg', CASE WHEN p.sold_by_weight THEN p.price ELSE NULL END
      )
      ORDER BY p.name
    ),
    '[]'::jsonb
  )
    INTO payload
    FROM public.products p
   WHERE p.organization_id = s.organization_id
     AND coalesce(p.available, true) = true
     AND coalesce(p.ingredient_stock_blocked, false) = false
     AND (
       coalesce(p.manage_stock, false) = false
       OR coalesce(p.stock_quantity, 0) > 0
     );

  UPDATE public.pdv_sessions
     SET last_seen_at = now()
   WHERE id = s.id;

  RETURN jsonb_build_object('ok', true, 'products', payload);
END
$function$;

REVOKE ALL ON FUNCTION public.pdv_catalog_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_catalog_v2(text) TO anon, authenticated, service_role;


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
  weight_text text;
  weight_kg numeric;
  line_total numeric;
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

    IF coalesce(p.sold_by_weight, false) THEN
      IF qty <> 1 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
      END IF;
      weight_text := btrim(coalesce(item->>'weight_kg', ''));
      IF weight_text !~ '^[0-9]+([.][0-9]{1,3})?
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


-- VisionFood V2 PHASE 270
-- Keep the intentionally anon-callable PDV sale RPC, but enforce the same
-- server-side payment configuration used by checkout.
--
-- Technical issue:
-- pdv_registrar_venda_v2 accepted "cartao" whenever the caller supplied that
-- literal, even when settings.pay_card_terminal_enabled was false. Because the
-- RPC is SECURITY DEFINER and callable by anon with a valid opaque PDV session,
-- client/UI restrictions are not an authorization boundary.

CREATE OR REPLACE FUNCTION public.pdv_registrar_venda_v2(
  _session_token text,
  _caixa_id uuid,
  _items jsonb,
  _forma text,
  _total numeric,
  _cupom_code text default '',
  _desconto numeric default 0
)
returns jsonb
language plpgsql
SECURITY DEFINER
SET search_path TO ''
as $function$
declare
  s public.pdv_sessions%rowtype;
  c public.caixas_pdv%rowtype;
  op public.operadores_pdv%rowtype;
  h text;
  oid uuid;
  onum text;
  ts timestamptz := now();
  item jsonb;
  p public.products%rowtype;
  canonical_items jsonb := '[]'::jsonb;
  qty integer;
  weight_text text;
  weight_kg numeric;
  line_total numeric;
  subtotal numeric := 0;
  discount numeric := 0;
  final_total numeric := 0;
  coupon public.cupons%rowtype;
  code text := upper(btrim(coalesce(_cupom_code, '')));
  v_forma text := lower(btrim(coalesce(_forma, '')));
  v_pay_cash boolean := true;
  v_pay_card_terminal boolean := false;
begin
  h := encode(extensions.digest(coalesce(_session_token, ''), 'sha256'), 'hex');

  select *
    into s
  from public.pdv_sessions
  where token_hash = h
    and revoked_at is null
    and expires_at > now();

  if s.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  select *
    into c
  from public.caixas_pdv
  where id = _caixa_id
    and organization_id = s.organization_id
    and operador_id = s.operador_id
    and status in ('open', 'aberto');

  if c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_cash_register');
  end if;

  if jsonb_typeof(_items) <> 'array'
     or jsonb_array_length(_items) = 0
     or v_forma not in ('dinheiro', 'cartao') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_sale');
  end if;

  select
    coalesce(st.pay_cash_enabled, true),
    coalesce(st.pay_card_terminal_enabled, false)
  into
    v_pay_cash,
    v_pay_card_terminal
  from public.settings st
  where st.organization_id = s.organization_id
  limit 1;

  if not found then
    v_pay_cash := true;
    v_pay_card_terminal := false;
  end if;

  if (v_forma = 'dinheiro' and not v_pay_cash)
     or (v_forma = 'cartao' and not v_pay_card_terminal) then
    return jsonb_build_object('ok', false, 'reason', 'payment_method_disabled');
  end if;

  for item in
    select value
    from jsonb_array_elements(_items)
  loop
    begin
      qty := (item->>'quantity')::integer;
    exception
      when others then
        return jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
    end;

    if qty is null or qty <= 0 or qty > 999 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
    end if;

    select *
      into p
    from public.products
    where id = (item->>'product_id')::uuid
      and organization_id = s.organization_id
      and coalesce(available, true) = true;

    if p.id is null then
      return jsonb_build_object(
        'ok', false,
        'reason', 'product_not_found',
        'product_id', item->>'product_id'
      );
    end if;

    if coalesce(p.sold_by_weight, false) then
      if qty <> 1 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
      end if;
      weight_text := btrim(coalesce(item->>'weight_kg', ''));
      if weight_text !~ '^[0-9]+([.][0-9]{1,3})?
  end loop;

  if code <> '' then
    select *
      into coupon
    from public.cupons
    where organization_id = s.organization_id
      and upper(codigo) = code
      and ativo = true
      and coalesce(status, true) = true
      and (validade is null or validade >= ts)
      and (data_inicio is null or data_inicio <= ts)
      and (data_fim is null or data_fim >= ts)
    limit 1;

    if coupon.id is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_coupon');
    end if;

    if subtotal < coalesce(coupon.minimo_pedido, 0) then
      return jsonb_build_object('ok', false, 'reason', 'coupon_minimum_not_met');
    end if;

    if lower(coalesce(coupon.tipo_desconto, coupon.tipo, '')) in
       ('percentual', 'porcentagem', 'percent', 'percentage') then
      discount := round(
        subtotal * greatest(0, least(coupon.valor, 100)) / 100,
        2
      );
    else
      discount := least(subtotal, greatest(0, coupon.valor));
    end if;
  end if;

  final_total := greatest(0, subtotal - discount);

  select *
    into op
  from public.operadores_pdv
  where id = s.operador_id;

  onum := public.next_order_number(s.organization_id);

  insert into public.orders(
    order_number,
    customer_name,
    customer_phone,
    order_type,
    items,
    total,
    status,
    organization_id,
    payment_method,
    forma_pagamento,
    metodo_pagamento,
    created_at,
    updated_at
  )
  values(
    onum,
    'Balcão',
    '',
    'pdv',
    canonical_items,
    final_total,
    'delivered',
    s.organization_id,
    v_forma,
    v_forma,
    v_forma,
    ts,
    ts
  )
  returning id into oid;

  insert into public.caixa_movimentos(
    caixa_id,
    organization_id,
    operador_id,
    operador_nome,
    tipo,
    forma_pagamento,
    valor,
    motivo,
    pedido_id,
    metadata
  )
  values(
    c.id,
    s.organization_id,
    s.operador_id,
    coalesce(op.name, op.nome, op.username, ''),
    'venda',
    v_forma,
    final_total,
    'Venda PDV',
    null,
    jsonb_build_object(
      'order_id', oid,
      'cupom', code,
      'desconto', discount,
      'subtotal', subtotal,
      'client_total_ignored', _total,
      'client_discount_ignored', _desconto
    )
  );

  if coupon.id is not null then
    update public.cupons
       set usos = coalesce(usos, 0) + 1,
           updated_at = now()
     where id = coupon.id;
  end if;

  update public.pdv_sessions
     set last_seen_at = now()
   where id = s.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', oid,
    'order_number', onum,
    'created_at', ts,
    'subtotal', subtotal,
    'desconto', discount,
    'total', final_total,
    'items', canonical_items
  );

exception
  when invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_product_id');
end
$function$;

REVOKE ALL ON FUNCTION public.pdv_registrar_venda_v2(text,uuid,jsonb,text,numeric,text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_registrar_venda_v2(text,uuid,jsonb,text,numeric,text,numeric) TO anon, authenticated, service_role;
