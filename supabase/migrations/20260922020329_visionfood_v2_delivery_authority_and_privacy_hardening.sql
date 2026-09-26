-- Second audit hardening for delivery transition authority and post-delivery privacy.

CREATE OR REPLACE FUNCTION public.visionfood_guard_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_allowed boolean:=false;
  v_age_seconds numeric;
  v_start_authorized boolean:=
    coalesce(pg_catalog.current_setting('visionfood.delivery_start_authorized',true),'')='1';
  v_complete_authorized boolean:=
    coalesce(pg_catalog.current_setting('visionfood.delivery_complete_authorized',true),'')='1';
  v_return_authorized boolean:=
    coalesce(pg_catalog.current_setting('visionfood.delivery_return_authorized',true),'')='1';
BEGIN
  IF new.status IS NOT DISTINCT FROM old.status THEN
    RETURN new;
  END IF;

  IF new.status='cancelled' THEN
    IF old.status NOT IN ('pending','preparing','ready','out_for_delivery') THEN
      RAISE EXCEPTION USING
        errcode='23514',
        message='invalid_order_status_transition:'||coalesce(old.status,'null')||'->cancelled';
    END IF;

    IF new.status_reembolso IS NULL OR new.status_reembolso='none' THEN
      v_age_seconds:=extract(epoch FROM (now()-old.created_at));
      new.status_reembolso:=CASE
        WHEN old.payment_status='paid'
             AND (old.status='pending' OR v_age_seconds<=300)
          THEN 'auto_eligible'
        WHEN old.payment_status='paid'
          THEN 'manual_required'
        WHEN old.payment_status IS NULL
          THEN 'manual_required'
        ELSE 'none'
      END;
    END IF;

    RETURN new;
  END IF;

  v_allowed:=CASE
    WHEN old.status='pending'
      THEN new.status='preparing'
    WHEN old.status='preparing'
      THEN new.status='ready'
    WHEN old.status='ready'
         AND old.order_type IN ('delivery','viagem')
      THEN new.status='out_for_delivery'
           AND new.entregador_id IS NOT NULL
           AND v_start_authorized
    WHEN old.status='ready'
         AND old.order_type NOT IN ('delivery','viagem')
      THEN new.status='delivered'
    WHEN old.status='out_for_delivery'
         AND old.order_type IN ('delivery','viagem')
      THEN (
        new.status='delivered'
        AND new.entregador_id IS NOT NULL
        AND v_complete_authorized
      ) OR (
        new.status='ready'
        AND new.entregador_id IS NULL
        AND v_return_authorized
      )
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION USING
      errcode='23514',
      message='invalid_order_status_transition:'||
              coalesce(old.status,'null')||'->'||coalesce(new.status,'null');
  END IF;

  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION public.visionfood_guard_order_status_transition() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.entregador_start_delivery_session(
  _session_token text,
  _order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_e public.entregadores%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_release_at timestamptz;
BEGIN
  v_e:=public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_session');
  END IF;

  SELECT *
    INTO v_order
  FROM public.orders
  WHERE id=_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','order_not_found'); END IF;
  IF v_order.organization_id<>v_e.organization_id THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
  IF v_order.order_type NOT IN ('delivery','viagem') THEN RETURN jsonb_build_object('ok',false,'reason','not_delivery'); END IF;
  IF v_order.entregador_id IS DISTINCT FROM v_e.id THEN RETURN jsonb_build_object('ok',false,'reason','not_assigned'); END IF;
  IF v_order.status='out_for_delivery' THEN
    RETURN jsonb_build_object('ok',true,'status','out_for_delivery','idempotent',true);
  END IF;
  IF v_order.status<>'ready' THEN
    RETURN jsonb_build_object('ok',false,'reason','not_ready','current_status',v_order.status);
  END IF;

  v_release_at:=private.visionfood_schedule_release_at(v_order.organization_id,v_order.scheduled_for);
  IF v_release_at IS NOT NULL AND now()<v_release_at THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','scheduled_not_released',
      'scheduled_for',v_order.scheduled_for,'release_at',v_release_at
    );
  END IF;

  PERFORM pg_catalog.set_config('visionfood.delivery_start_authorized','1',true);

  UPDATE public.orders
     SET status='out_for_delivery',
         delivery_started_at=now(),
         delivery_issue_reason=NULL,
         delivery_issue_at=NULL,
         updated_at=now()
   WHERE id=v_order.id;

  INSERT INTO private.delivery_events(
    organization_id,order_id,entregador_id,event_type,actor_kind
  ) VALUES (
    v_order.organization_id,v_order.id,v_e.id,'started','driver'
  );

  RETURN jsonb_build_object('ok',true,'status','out_for_delivery','idempotent',false);
END
$function$;

REVOKE ALL ON FUNCTION public.entregador_start_delivery_session(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entregador_start_delivery_session(text,uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_delivery_with_code_session(
  _session_token text,
  _order_id uuid,
  _code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_e public.entregadores%rowtype;
  v_order public.orders%rowtype;
  v_attempt private.delivery_code_attempts%rowtype;
  v_next_attempts integer;
  v_driver_lat double precision;
  v_driver_lng double precision;
  v_h double precision;
  v_distance_m double precision;
BEGIN
  v_e:=public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_session');
  END IF;

  IF _code IS NULL OR _code !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_code_format');
  END IF;

  SELECT *
    INTO v_order
  FROM public.orders
  WHERE id=_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','order_not_found');
  END IF;

  IF v_order.organization_id<>v_e.organization_id THEN
    RETURN jsonb_build_object('ok',false,'reason','forbidden');
  END IF;

  IF v_order.order_type NOT IN ('delivery','viagem') THEN
    RETURN jsonb_build_object('ok',false,'reason','not_delivery_order');
  END IF;

  IF v_order.entregador_id IS DISTINCT FROM v_e.id THEN
    RETURN jsonb_build_object('ok',false,'reason','not_assigned');
  END IF;

  IF v_order.status='delivered' THEN
    RETURN jsonb_build_object('ok',false,'reason','already_delivered');
  END IF;

  IF v_order.status='cancelled' THEN
    RETURN jsonb_build_object('ok',false,'reason','cancelled');
  END IF;

  IF v_order.status<>'out_for_delivery' THEN
    RETURN jsonb_build_object(
      'ok',false,
      'reason','not_out_for_delivery',
      'current_status',v_order.status
    );
  END IF;

  IF v_order.delivery_lat IS NOT NULL
     AND v_order.delivery_lng IS NOT NULL
     AND v_order.delivery_accuracy_m IS NOT NULL
     AND v_order.delivery_accuracy_m>0
     AND v_order.delivery_accuracy_m<=100 THEN
    IF v_e.ultima_lat IS NULL
       OR v_e.ultima_lng IS NULL
       OR v_e.ultima_localizacao_at IS NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','driver_location_required');
    END IF;

    IF v_e.ultima_localizacao_pedido_id IS DISTINCT FROM _order_id
       OR v_e.ultima_localizacao_at<now()-interval '2 minutes' THEN
      RETURN jsonb_build_object('ok',false,'reason','driver_location_stale');
    END IF;

    v_driver_lat:=v_e.ultima_lat::double precision;
    v_driver_lng:=v_e.ultima_lng::double precision;

    v_h:=
      power(sin(radians((v_driver_lat-v_order.delivery_lat)/2)),2)
      +cos(radians(v_order.delivery_lat))
       *cos(radians(v_driver_lat))
       *power(sin(radians((v_driver_lng-v_order.delivery_lng)/2)),2);

    v_distance_m:=6371000*2*asin(sqrt(least(1.0,greatest(0.0,v_h))));

    IF v_distance_m>200 THEN
      RETURN jsonb_build_object(
        'ok',false,
        'reason','delivery_geofence_exceeded',
        'distance_m',round(v_distance_m::numeric,1),
        'max_distance_m',200
      );
    END IF;
  END IF;

  SELECT *
    INTO v_attempt
  FROM private.delivery_code_attempts
  WHERE order_id=_order_id
    AND entregador_id=v_e.id
  FOR UPDATE;

  IF FOUND
     AND v_attempt.blocked_until IS NOT NULL
     AND v_attempt.blocked_until>now() THEN
    RETURN jsonb_build_object(
      'ok',false,
      'reason','too_many_attempts',
      'retry_after_seconds',
      greatest(1,ceil(extract(epoch from (v_attempt.blocked_until-now())))::integer)
    );
  END IF;

  IF coalesce(v_order.delivery_code,'')=''
     OR v_order.delivery_code<>_code THEN
    v_next_attempts:=CASE
      WHEN FOUND AND coalesce(v_attempt.blocked_until,'-infinity'::timestamptz)<=now()
        THEN coalesce(v_attempt.attempts,0)+1
      ELSE 1
    END;

    INSERT INTO private.delivery_code_attempts(
      order_id,entregador_id,attempts,blocked_until,updated_at
    )
    VALUES(
      _order_id,
      v_e.id,
      v_next_attempts,
      CASE WHEN v_next_attempts>=5 THEN now()+interval '10 minutes' ELSE NULL END,
      now()
    )
    ON CONFLICT(order_id,entregador_id) DO UPDATE
      SET attempts=excluded.attempts,
          blocked_until=excluded.blocked_until,
          updated_at=now();

    IF v_next_attempts>=5 THEN
      RETURN jsonb_build_object(
        'ok',false,
        'reason','too_many_attempts',
        'retry_after_seconds',600
      );
    END IF;

    RETURN jsonb_build_object(
      'ok',false,
      'reason','invalid_code',
      'remaining_attempts',5-v_next_attempts
    );
  END IF;

  DELETE FROM private.delivery_code_attempts
  WHERE order_id=_order_id
    AND entregador_id=v_e.id;

  PERFORM pg_catalog.set_config('visionfood.delivery_complete_authorized','1',true);

  UPDATE public.orders
     SET status='delivered',
         updated_at=now()
   WHERE id=_order_id;

  INSERT INTO public.entregas_log(
    order_id,organization_id,entregador_id,delivered_at
  )
  VALUES(
    _order_id,v_order.organization_id,v_e.id,now()
  )
  ON CONFLICT(order_id) DO NOTHING;

  RETURN jsonb_build_object('ok',true,'status','delivered');
END
$function$;

REVOKE ALL ON FUNCTION public.confirm_delivery_with_code_session(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_delivery_with_code_session(text,uuid,text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.entregador_orders_session(_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_e public.entregadores%ROWTYPE;
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
        'customer_phone',CASE WHEN o.status='delivered' THEN '' ELSE o.customer_phone END,
        'delivery_address',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_address END,
        'delivery_reference',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_reference END,
        'delivery_recipient',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_recipient END,
        'bairro_nome',o.bairro_nome,
        'delivery_lat',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_lat END,
        'delivery_lng',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_lng END,
        'delivery_accuracy_m',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_accuracy_m END,
        'delivery_assigned_at',o.delivery_assigned_at,
        'delivery_started_at',o.delivery_started_at,
        'delivery_issue_reason',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_issue_reason END,
        'delivery_issue_at',CASE WHEN o.status='delivered' THEN NULL ELSE o.delivery_issue_at END,
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

REVOKE ALL ON FUNCTION public.entregador_orders_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entregador_orders_session(text)
  TO anon, authenticated, service_role;
