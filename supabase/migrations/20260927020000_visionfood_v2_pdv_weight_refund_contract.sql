-- VisionFood V2 — PDV weighted refund contract
-- Additive replacement of only public.pdv_devolver_pedido_v2.
--
-- Reuses the existing sale contract:
--   unit item: quantity is the sold/refunded unit count;
--   weighted item: quantity = 1 and weight_kg carries the sold/refunded weight.
--
-- The immutable orders.items snapshot remains authoritative for price, weight and
-- line total. Client _valor_devolucao is audit metadata only. This function keeps
-- the order row lock, prior-refund limits, proportional order discount and the
-- existing rule that financial refunds do NOT automatically restore stock.

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
SET search_path TO ''
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
  sale_pid uuid;
  qty integer;
  sale_qty integer;
  oqty bigint;

  sale_name text;
  item_name text;
  sale_weighted boolean;
  original_weighted boolean;
  sale_price numeric;
  unit_price numeric;

  sale_weight_text text;
  sale_weight numeric;
  sold_weight numeric;
  req_weight_text text;
  req_weight numeric;
  prior_weight numeric;
  available_weight numeric;

  sale_price_per_kg numeric;
  sale_total numeric;
  expected_total numeric;
  line_total numeric;

  prior_qty bigint;
  available_qty bigint;
  prior_match_count bigint;
  prior_valid_weight_count bigint;

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

  -- Preserve the existing serialization/idempotency boundary for one order.
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

  -- Validate every immutable sale item first and calculate the original gross
  -- using exact numeric arithmetic. Weighted line total is authoritative only
  -- after it agrees with price_per_kg * weight_kg rounded to cents.
  FOR sale_item IN
    SELECT value
      FROM jsonb_array_elements(o.items)
  LOOP
    BEGIN
      sale_pid := (sale_item->>'product_id')::uuid;
      sale_qty := (sale_item->>'quantity')::integer;
      sale_price := (sale_item->>'price')::numeric;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_item');
    END;

    IF sale_pid IS NULL OR sale_qty IS NULL OR sale_qty <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_item');
    END IF;

    IF sale_price IS NULL OR sale_price < 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_price');
    END IF;

    IF sale_item ? 'sold_by_weight'
       AND sale_item->'sold_by_weight' <> 'null'::jsonb THEN
      IF jsonb_typeof(sale_item->'sold_by_weight') <> 'boolean' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_item');
      END IF;
      sale_weighted := (sale_item->>'sold_by_weight')::boolean;
    ELSE
      sale_weighted := sale_item->>'weight_kg' IS NOT NULL;
    END IF;

    IF sale_weighted THEN
      IF sale_qty <> 1 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_item');
      END IF;

      sale_weight_text := btrim(coalesce(sale_item->>'weight_kg', ''));
      IF sale_weight_text !~ '^[0-9]+([.][0-9]{1,3})?$' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_weight');
      END IF;

      sale_weight := sale_weight_text::numeric;
      IF sale_weight <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_weight');
      END IF;

      BEGIN
        sale_price_per_kg := coalesce(
          nullif(btrim(coalesce(sale_item->>'price_per_kg', '')), '')::numeric,
          sale_price
        );
        sale_total := (sale_item->>'total')::numeric;
      EXCEPTION WHEN others THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_price');
      END;

      IF sale_price_per_kg IS NULL
         OR sale_price_per_kg < 0
         OR sale_price_per_kg <> sale_price THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_price');
      END IF;

      expected_total := round(sale_price_per_kg * sale_weight, 2);
      IF sale_total IS NULL
         OR sale_total < 0
         OR sale_total <> expected_total THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_total');
      END IF;
    ELSE
      IF sale_item->>'weight_kg' IS NOT NULL
         OR sale_item->>'price_per_kg' IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_item');
      END IF;

      expected_total := round(sale_price * sale_qty, 2);
      IF sale_item->>'total' IS NULL THEN
        sale_total := expected_total;
      ELSE
        BEGIN
          sale_total := (sale_item->>'total')::numeric;
        EXCEPTION WHEN others THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_total');
        END;

        IF sale_total < 0 OR sale_total <> expected_total THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_total');
        END IF;
      END IF;
    END IF;

    gross_total := gross_total + sale_total;
  END LOOP;

  IF gross_total <= 0 OR o.total IS NULL OR o.total < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_total');
  END IF;

  -- Preserve the order-level discount proportion used by Phase 264.
  refund_factor := least(
    1::numeric,
    greatest(0::numeric, o.total / gross_total)
  );

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

    IF pid IS NULL OR qty IS NULL OR qty <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return_quantity');
    END IF;

    IF seen_products ? pid::text THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_return_item');
    END IF;
    seen_products := seen_products || jsonb_build_object(pid::text, true);

    -- Rebuild the authoritative sold quantity/weight for this product from the
    -- immutable order snapshot. Duplicate sale lines are tolerated only when
    -- they use the same sale mode and unit price.
    original_weighted := NULL;
    oqty := 0;
    sold_weight := 0;
    unit_price := NULL;
    item_name := '';

    FOR sale_item IN
      SELECT value
        FROM jsonb_array_elements(o.items)
       WHERE (value->>'product_id')::uuid = pid
    LOOP
      sale_qty := (sale_item->>'quantity')::integer;
      sale_price := (sale_item->>'price')::numeric;
      sale_name := coalesce(sale_item->>'name', '');

      IF sale_item ? 'sold_by_weight'
         AND sale_item->'sold_by_weight' <> 'null'::jsonb THEN
        sale_weighted := (sale_item->>'sold_by_weight')::boolean;
      ELSE
        sale_weighted := sale_item->>'weight_kg' IS NOT NULL;
      END IF;

      IF original_weighted IS NULL THEN
        original_weighted := sale_weighted;
      ELSIF original_weighted <> sale_weighted THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_item');
      END IF;

      IF item_name = '' THEN
        item_name := sale_name;
      END IF;

      IF sale_weighted THEN
        sale_weight := (sale_item->>'weight_kg')::numeric;
        sale_price_per_kg := coalesce(
          nullif(btrim(coalesce(sale_item->>'price_per_kg', '')), '')::numeric,
          sale_price
        );

        IF unit_price IS NULL THEN
          unit_price := sale_price_per_kg;
        ELSIF unit_price <> sale_price_per_kg THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_price');
        END IF;

        sold_weight := sold_weight + sale_weight;
      ELSE
        IF unit_price IS NULL THEN
          unit_price := sale_price;
        ELSIF unit_price <> sale_price THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'invalid_original_price');
        END IF;

        oqty := oqty + sale_qty;
      END IF;
    END LOOP;

    IF original_weighted IS NULL OR unit_price IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'item_not_in_order');
    END IF;

    IF original_weighted THEN
      -- Weighted items keep quantity=1. Partial refund is expressed only by
      -- weight_kg, never by fractional quantity.
      IF qty <> 1 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return_quantity');
      END IF;

      req_weight_text := btrim(coalesce(req->>'weight_kg', ''));
      IF req_weight_text !~ '^[0-9]+([.][0-9]{1,3})?$' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return_weight');
      END IF;

      req_weight := req_weight_text::numeric;
      IF req_weight <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return_weight');
      END IF;

      -- If any previous refund for this weighted product lacks a valid weight,
      -- fail closed rather than pretending quantity=1 identifies how much weight
      -- was already returned.
      SELECT
        count(*),
        count(*) FILTER (
          WHERE CASE
            WHEN coalesce(ri->>'weight_kg', '') ~ '^[0-9]+([.][0-9]{1,3})?
      INTO prior_match_count, prior_valid_weight_count, prior_weight
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

      IF prior_match_count <> prior_valid_weight_count THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_refund_history');
      END IF;

      available_weight := greatest(sold_weight - prior_weight, 0);

      IF req_weight > available_weight THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'return_weight_exceeds_available',
          'product_id', pid,
          'sold_weight_kg', sold_weight,
          'already_refunded_weight_kg', prior_weight,
          'available_weight_kg', available_weight
        );
      END IF;

      line_total := round(unit_price * req_weight, 2);
      canon := canon || jsonb_build_array(
        jsonb_build_object(
          'product_id', pid,
          'name', item_name,
          'quantity', 1,
          'price', unit_price,
          'weight_kg', req_weight,
          'price_per_kg', unit_price,
          'sold_by_weight', true,
          'total', line_total
        )
      );
      requested_gross := requested_gross + line_total;
    ELSE
      IF req->>'weight_kg' IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return_weight');
      END IF;

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

      available_qty := greatest(oqty - prior_qty, 0);

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

      line_total := round(unit_price * qty, 2);
      canon := canon || jsonb_build_array(
        jsonb_build_object(
          'product_id', pid,
          'name', item_name,
          'quantity', qty,
          'price', unit_price,
          'weight_kg', NULL,
          'price_per_kg', NULL,
          'sold_by_weight', false,
          'total', line_total
        )
      );
      requested_gross := requested_gross + line_total;
    END IF;
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

  -- Stock/recomposition intentionally remains unchanged from Phase 264:
  -- a financial return does not silently restore prepared product/ingredients.

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

              THEN (ri->>'weight_kg')::numeric > 0
            ELSE false
          END
        ),
        coalesce(sum(
          CASE
            WHEN coalesce(ri->>'weight_kg', '') ~ '^[0-9]+([.][0-9]{1,3})?
      INTO prior_match_count, prior_valid_weight_count, prior_weight
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

      IF prior_match_count <> prior_valid_weight_count THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_refund_history');
      END IF;

      available_weight := greatest(sold_weight - prior_weight, 0);

      IF req_weight > available_weight THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'return_weight_exceeds_available',
          'product_id', pid,
          'sold_weight_kg', sold_weight,
          'already_refunded_weight_kg', prior_weight,
          'available_weight_kg', available_weight
        );
      END IF;

      line_total := round(unit_price * req_weight, 2);
      canon := canon || jsonb_build_array(
        jsonb_build_object(
          'product_id', pid,
          'name', item_name,
          'quantity', 1,
          'price', unit_price,
          'weight_kg', req_weight,
          'price_per_kg', unit_price,
          'sold_by_weight', true,
          'total', line_total
        )
      );
      requested_gross := requested_gross + line_total;
    ELSE
      IF req->>'weight_kg' IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return_weight');
      END IF;

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

      available_qty := greatest(oqty - prior_qty, 0);

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

      line_total := round(unit_price * qty, 2);
      canon := canon || jsonb_build_array(
        jsonb_build_object(
          'product_id', pid,
          'name', item_name,
          'quantity', qty,
          'price', unit_price,
          'weight_kg', NULL,
          'price_per_kg', NULL,
          'sold_by_weight', false,
          'total', line_total
        )
      );
      requested_gross := requested_gross + line_total;
    END IF;
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

  -- Stock/recomposition intentionally remains unchanged from Phase 264:
  -- a financial return does not silently restore prepared product/ingredients.

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

              THEN CASE
                WHEN (ri->>'weight_kg')::numeric > 0
                  THEN (ri->>'weight_kg')::numeric
                ELSE 0
              END
            ELSE 0
          END
        ), 0)
      INTO prior_match_count, prior_valid_weight_count, prior_weight
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

      IF prior_match_count <> prior_valid_weight_count THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_refund_history');
      END IF;

      available_weight := greatest(sold_weight - prior_weight, 0);

      IF req_weight > available_weight THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'return_weight_exceeds_available',
          'product_id', pid,
          'sold_weight_kg', sold_weight,
          'already_refunded_weight_kg', prior_weight,
          'available_weight_kg', available_weight
        );
      END IF;

      line_total := round(unit_price * req_weight, 2);
      canon := canon || jsonb_build_array(
        jsonb_build_object(
          'product_id', pid,
          'name', item_name,
          'quantity', 1,
          'price', unit_price,
          'weight_kg', req_weight,
          'price_per_kg', unit_price,
          'sold_by_weight', true,
          'total', line_total
        )
      );
      requested_gross := requested_gross + line_total;
    ELSE
      IF req->>'weight_kg' IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_return_weight');
      END IF;

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

      available_qty := greatest(oqty - prior_qty, 0);

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

      line_total := round(unit_price * qty, 2);
      canon := canon || jsonb_build_array(
        jsonb_build_object(
          'product_id', pid,
          'name', item_name,
          'quantity', qty,
          'price', unit_price,
          'weight_kg', NULL,
          'price_per_kg', NULL,
          'sold_by_weight', false,
          'total', line_total
        )
      );
      requested_gross := requested_gross + line_total;
    END IF;
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

  -- Stock/recomposition intentionally remains unchanged from Phase 264:
  -- a financial return does not silently restore prepared product/ingredients.

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
