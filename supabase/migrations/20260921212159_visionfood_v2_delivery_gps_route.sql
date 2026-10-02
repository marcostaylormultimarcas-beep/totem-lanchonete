-- Persist customer-confirmed GPS destination for authorized delivery routing.
-- Exact coordinates are not exposed in the free-claim order list; only the assigned
-- driver receives them, and delivered-history responses intentionally return NULL.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_lat double precision,
  ADD COLUMN IF NOT EXISTS delivery_lng double precision,
  ADD COLUMN IF NOT EXISTS delivery_accuracy_m double precision;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivery_lat_range_chk
    CHECK (delivery_lat IS NULL OR (delivery_lat >= -90 AND delivery_lat <= 90)),
  ADD CONSTRAINT orders_delivery_lng_range_chk
    CHECK (delivery_lng IS NULL OR (delivery_lng >= -180 AND delivery_lng <= 180)),
  ADD CONSTRAINT orders_delivery_coords_pair_chk
    CHECK ((delivery_lat IS NULL) = (delivery_lng IS NULL)),
  ADD CONSTRAINT orders_delivery_accuracy_range_chk
    CHECK (delivery_accuracy_m IS NULL OR (delivery_accuracy_m >= 0 AND delivery_accuracy_m <= 100000));

COMMENT ON COLUMN public.orders.delivery_lat IS
  'Customer-confirmed delivery latitude captured from browser geolocation; exposed only through authorized delivery/admin contracts.';
COMMENT ON COLUMN public.orders.delivery_lng IS
  'Customer-confirmed delivery longitude captured from browser geolocation; exposed only through authorized delivery/admin contracts.';
COMMENT ON COLUMN public.orders.delivery_accuracy_m IS
  'Browser-reported geolocation accuracy in meters when delivery coordinates were captured.';

CREATE OR REPLACE FUNCTION public.create_order_checkout_v4(
  _organization_id uuid,
  _customer_name text,
  _customer_phone text DEFAULT ''::text,
  _customer_cpf text DEFAULT ''::text,
  _order_type text DEFAULT 'local'::text,
  _delivery_address text DEFAULT ''::text,
  _delivery_reference text DEFAULT ''::text,
  _delivery_recipient text DEFAULT ''::text,
  _bairro_id uuid DEFAULT NULL::uuid,
  _bairro_nome text DEFAULT ''::text,
  _delivery_fee numeric DEFAULT 0,
  _items jsonb DEFAULT '[]'::jsonb,
  _total numeric DEFAULT 0,
  _payment_method text DEFAULT ''::text,
  _scheduled_for timestamptz DEFAULT NULL::timestamptz,
  _coupon_code text DEFAULT ''::text,
  _delivery_context jsonb DEFAULT '{}'::jsonb,
  _table_token uuid DEFAULT NULL::uuid,
  _client_request_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  id uuid,
  order_number text,
  delivery_code text,
  table_label text,
  table_session_id uuid,
  idempotent boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  existing public.orders%rowtype;
  t private.restaurant_tables%rowtype;
  sess private.table_sessions%rowtype;
  created record;
  accepts_table boolean;
  uid uuid;
  v_delivery_lat double precision;
  v_delivery_lng double precision;
  v_delivery_accuracy_m double precision;
BEGIN
  uid:=auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF _organization_id IS NULL OR _client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_checkout_request';
  END IF;

  IF _order_type IN ('delivery','viagem')
     AND ((_delivery_context ? 'lat') OR (_delivery_context ? 'lng')) THEN
    IF jsonb_typeof(_delivery_context->'lat') <> 'number'
       OR jsonb_typeof(_delivery_context->'lng') <> 'number' THEN
      RAISE EXCEPTION 'invalid_delivery_coordinates';
    END IF;

    v_delivery_lat:=(_delivery_context->>'lat')::double precision;
    v_delivery_lng:=(_delivery_context->>'lng')::double precision;

    IF v_delivery_lat < -90 OR v_delivery_lat > 90
       OR v_delivery_lng < -180 OR v_delivery_lng > 180 THEN
      RAISE EXCEPTION 'invalid_delivery_coordinates';
    END IF;

    IF _delivery_context ? 'accuracy_m'
       AND _delivery_context->'accuracy_m' <> 'null'::jsonb THEN
      IF jsonb_typeof(_delivery_context->'accuracy_m') <> 'number' THEN
        RAISE EXCEPTION 'invalid_delivery_accuracy';
      END IF;
      v_delivery_accuracy_m:=(_delivery_context->>'accuracy_m')::double precision;
      IF v_delivery_accuracy_m < 0 OR v_delivery_accuracy_m > 100000 THEN
        RAISE EXCEPTION 'invalid_delivery_accuracy';
      END IF;
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'visionfood:checkout-request:'||_organization_id::text||':'||_client_request_id::text,
      0
    )
  );

  SELECT *
    INTO existing
  FROM public.orders o
  WHERE o.organization_id=_organization_id
    AND o.client_request_id=_client_request_id
    AND o.kiosk_device_id IS NULL
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF existing.user_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'checkout_request_conflict'; END IF;
    RETURN QUERY
    SELECT existing.id,existing.order_number,coalesce(existing.delivery_code,''),
           coalesce(existing.table_label,''),existing.table_session_id,true;
    RETURN;
  END IF;

  IF _table_token IS NOT NULL THEN
    IF _order_type<>'local' THEN RAISE EXCEPTION 'table_requires_local_order'; END IF;

    SELECT coalesce(c.aceita_mesa,true)
      INTO accepts_table
    FROM public.organizations o
    LEFT JOIN public.configuracoes c ON c.organization_id=o.id
    WHERE o.id=_organization_id
    LIMIT 1;

    IF coalesce(accepts_table,false) IS NOT TRUE THEN RAISE EXCEPTION 'table_orders_disabled'; END IF;

    SELECT *
      INTO t
    FROM private.restaurant_tables rt
    WHERE rt.organization_id=_organization_id
      AND rt.public_token=_table_token
      AND rt.active=true
    LIMIT 1;

    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_table_token'; END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('visionfood:table-session:'||t.id::text,0)
    );

    SELECT *
      INTO sess
    FROM private.table_sessions ts
    WHERE ts.table_id=t.id AND ts.status='open'
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO private.table_sessions(organization_id,table_id)
      VALUES(_organization_id,t.id)
      RETURNING * INTO sess;
    END IF;
  END IF;

  SELECT *
    INTO created
  FROM public.create_order_checkout_v3(
    _organization_id,_customer_name,_customer_phone,_customer_cpf,_order_type,
    _delivery_address,_delivery_reference,_delivery_recipient,_bairro_id,_bairro_nome,
    _delivery_fee,_items,_total,_payment_method,_scheduled_for,_coupon_code,_delivery_context
  );

  IF created.id IS NULL THEN RAISE EXCEPTION 'checkout_create_failed'; END IF;

  UPDATE public.orders o
     SET client_request_id=_client_request_id,
         table_id=CASE WHEN _table_token IS NULL THEN NULL ELSE t.id END,
         table_session_id=CASE WHEN _table_token IS NULL THEN NULL ELSE sess.id END,
         table_label=CASE WHEN _table_token IS NULL THEN '' ELSE t.label END,
         delivery_lat=CASE WHEN _order_type IN ('delivery','viagem') THEN v_delivery_lat ELSE NULL END,
         delivery_lng=CASE WHEN _order_type IN ('delivery','viagem') THEN v_delivery_lng ELSE NULL END,
         delivery_accuracy_m=CASE WHEN _order_type IN ('delivery','viagem') THEN v_delivery_accuracy_m ELSE NULL END,
         updated_at=now()
   WHERE o.id=created.id
     AND o.organization_id=_organization_id;

  RETURN QUERY
  SELECT created.id::uuid,created.order_number::text,coalesce(created.delivery_code,'')::text,
         CASE WHEN _table_token IS NULL THEN '' ELSE t.label END,
         CASE WHEN _table_token IS NULL THEN NULL ELSE sess.id END,
         false;
END
$function$;

REVOKE ALL ON FUNCTION public.create_order_checkout_v4(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb,uuid,uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_checkout_v4(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb,uuid,uuid
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.entregador_orders_session(_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_e public.entregadores%rowtype;
  v_rows jsonb;
BEGIN
  v_e:=public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_session');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'customer_name',o.customer_name,
        'customer_phone',o.customer_phone,
        'delivery_address',o.delivery_address,
        'delivery_reference',o.delivery_reference,
        'delivery_recipient',o.delivery_recipient,
        'bairro_nome',o.bairro_nome,
        'delivery_lat',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_lat END,
        'delivery_lng',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_lng END,
        'delivery_accuracy_m',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_accuracy_m END,
        'items',coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'name',i->>'name',
              'quantity',coalesce(i->'quantity','1'::jsonb)
            )
          )
          FROM jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) i
        ),'[]'::jsonb),
        'total',o.total,
        'status',o.status,
        'order_type',o.order_type,
        'scheduled_for',o.scheduled_for,
        'created_at',o.created_at
      )
      ORDER BY coalesce(o.scheduled_for,o.created_at) DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.orders o
  WHERE o.organization_id=v_e.organization_id
    AND o.entregador_id=v_e.id
    AND o.status IN ('preparing','out_for_delivery','ready','delivered')
    AND (
      o.status='delivered'
      OR o.scheduled_for IS NULL
      OR now()>=private.visionfood_schedule_release_at(o.organization_id,o.scheduled_for)
    )
    AND (
      o.created_at>now()-interval '7 days'
      OR o.scheduled_for>now()-interval '7 days'
    );

  RETURN jsonb_build_object('ok',true,'orders',v_rows);
END
$function$;

REVOKE ALL ON FUNCTION public.entregador_orders_session(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entregador_orders_session(text) TO anon, authenticated, service_role;
