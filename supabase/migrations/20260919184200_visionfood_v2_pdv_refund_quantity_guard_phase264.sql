-- VisionFood V2 PHASE 264
-- Fix only public.pdv_devolver_pedido_v2(text,uuid,uuid,jsonb,numeric,text).
-- Anonymous exposure remains intentional because PDV clients authenticate with
-- the opaque server-issued _session_token.
--
-- Hardening:
-- 1) reject duplicate product ids inside one refund request;
-- 2) account for quantities already refunded for each product;
-- 3) keep the order row lock so concurrent refunds serialize;
-- 4) calculate the authoritative refund from server-side order data and
--    proportionally preserve any order-level discount;
-- 5) keep inventory unchanged here. Full cancellation owns automatic stock
--    restock; a financial return must not silently put prepared items back in stock.

CREATE OR REPLACE FUNCTION public.pdv_devolver_pedido_v2(
  _session_token text,
  _caixa_id uuid,
  _order_id uuid,
  _items_devolvidos jsonb,
  _valor_devolucao numeric,
  _motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  s public.pdv_sessions%rowtype;
  c public.caixas_pdv%rowtype;
  o public.orders%rowtype;
  op public.operadores_pdv%rowtype;

  h text;
  req jsonb;
  sale_item jsonb;
  canon jsonb := '[]'::jsonb;
  seen_products jsonb := '{}'::jsonb;

  pid uuid;
  qty integer;
  oqty integer;
  sale_qty integer;
  unit_price numeric;
  unit_price_max numeric;
  sale_price numeric;

  prior_qty bigint;
  available_qty bigint;

  gross_total numeric := 0;
  requested_gross numeric := 0;
  refund_factor numeric := 0;
  calc_refund numeric := 0;
  prior_refund numeric := 0;
  remaining numeric := 0;
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

  -- Serialize all refunds for the same order before reading prior refund state.
  SELECT *
    INTO o
    FROM public.orders
   WHERE id = _order_id
     AND organization_id = s.organization_id
     AND order_type = 'pdv'
   FOR UPDATE;

  IF o.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  IF jsonb_typeof(_items_devolvidos) <> 'array'
     OR jsonb_array_length(_items_devolvidos) = 0
     OR length(btrim(coalesce(_motivo, ''))) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return');
  END IF;

  IF jsonb_typeof(o.items) <> 'array'
     OR jsonb_array_length(o.items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_items');
  END IF;

  -- Validate the immutable sale snapshot and calculate the original gross total.
  FOR sale_item IN
    SELECT value
      FROM jsonb_array_elements(o.items)
  LOOP
    BEGIN
      sale_qty := (sale_item->>'quantity')::integer;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_item');
    END;

    BEGIN
      sale_price := (sale_item->>'price')::numeric;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_price');
    END;

    IF sale_qty IS NULL OR sale_qty <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_item');
    END IF;

    IF sale_price IS NULL OR sale_price < 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_price');
    END IF;

    gross_total := gross_total + (sale_price * sale_qty);
  END LOOP;

  IF gross_total <= 0 OR o.total < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_total');
  END IF;

  -- For discounted PDV orders, each returned item receives the same proportional
  -- share of the actual amount paid. Never refund an item above its sale price.
  refund_factor := least(1::numeric, greatest(0::numeric, o.total / gross_total));

  FOR req IN
    SELECT value
      FROM jsonb_array_elements(_items_devolvidos)
  LOOP
    BEGIN
      pid := (req->>'product_id')::uuid;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return_item');
    END;

    BEGIN
      qty := (req->>'quantity')::integer;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return_quantity');
    END;

    IF qty IS NULL OR qty <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return_quantity');
    END IF;

    IF seen_products ? pid::text THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_return_item');
    END IF;
    seen_products := seen_products || jsonb_build_object(pid::text, true);

    -- Sum duplicate sale lines defensively. The canonical PDV UI normally stores
    -- one line per product, but the refund guard must not rely on the client.
    SELECT
      coalesce(sum((value->>'quantity')::integer), 0)::integer,
      min((value->>'price')::numeric),
      max((value->>'price')::numeric)
    INTO
      oqty,
      unit_price,
      unit_price_max
    FROM jsonb_array_elements(o.items)
    WHERE value->>'product_id' = pid::text;

    IF oqty IS NULL OR oqty <= 0 OR unit_price IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'item_not_in_order');
    END IF;

    IF unit_price < 0
       OR unit_price_max IS NULL
       OR unit_price <> unit_price_max THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_price');
    END IF;

    -- Historical refunds written by this RPC persist canonical item quantities in
    -- caixa_movimentos.metadata.items. Count them per product before accepting more.
    SELECT coalesce(sum(
      CASE
        WHEN (ri->>'quantity') ~ '^[0-9]+$'
          THEN (ri->>'quantity')::bigint
        ELSE 0
      END
    ), 0)
    INTO prior_qty
    FROM public.caixa_movimentos cm
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(cm.metadata->'items') = 'array'
          THEN cm.metadata->'items'
        ELSE '[]'::jsonb
      END
    ) ri
    WHERE cm.organization_id = s.organization_id
      AND cm.tipo = 'devolucao'
      AND cm.pedido_id = o.id
      AND ri->>'product_id' = pid::text;

    available_qty := greatest(oqty::bigint - prior_qty, 0);

    IF qty::bigint > available_qty THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'return_quantity_exceeds_available',
        'product_id', pid,
        'sold_quantity', oqty,
        'already_refunded_quantity', prior_qty,
        'available_quantity', available_qty
      );
    END IF;

    canon := canon || jsonb_build_array(
      jsonb_build_object(
        'product_id', pid,
        'name', coalesce(
          (
            SELECT value->>'name'
              FROM jsonb_array_elements(o.items)
             WHERE value->>'product_id' = pid::text
             LIMIT 1
          ),
          ''
        ),
        'quantity', qty,
        'price', unit_price
      )
    );

    requested_gross := requested_gross + (unit_price * qty);
  END LOOP;

  SELECT coalesce(sum(valor), 0)
    INTO prior_refund
    FROM public.caixa_movimentos
   WHERE organization_id = s.organization_id
     AND tipo = 'devolucao'
     AND pedido_id = o.id;

  remaining := greatest(o.total - prior_refund, 0);
  calc_refund := round(requested_gross * refund_factor, 2);
  calc_refund := least(calc_refund, remaining);

  IF calc_refund <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nothing_left_to_refund');
  END IF;

  SELECT *
    INTO op
    FROM public.operadores_pdv
   WHERE id = s.operador_id;

  INSERT INTO public.caixa_movimentos(
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
  VALUES(
    c.id,
    s.organization_id,
    s.operador_id,
    coalesce(op.name, op.nome, op.username, ''),
    'devolucao',
    coalesce(
      o.forma_pagamento,
      o.payment_method,
      o.metodo_pagamento,
      'dinheiro'
    ),
    calc_refund,
    btrim(_motivo),
    o.id,
    jsonb_build_object(
      'order_id', o.id,
      'order_number', o.order_number,
      'items', canon,
      'gross_return_value', requested_gross,
      'refund_factor', refund_factor,
      'client_requested_value', _valor_devolucao
    )
  );

  UPDATE public.pdv_sessions
     SET last_seen_at = now()
   WHERE id = s.id;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', o.id,
    'valor_devolucao', calc_refund,
    'items', canon
  );
END
$function$;

REVOKE ALL ON FUNCTION public.pdv_devolver_pedido_v2(
  text, uuid, uuid, jsonb, numeric, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.pdv_devolver_pedido_v2(
  text, uuid, uuid, jsonb, numeric, text
) TO anon, authenticated, service_role;
