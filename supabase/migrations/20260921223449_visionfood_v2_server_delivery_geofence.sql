-- Re-enforce the delivery geofence on the server when a precise customer GPS
-- destination is available. The driver UI sends a fresh location sample for the
-- exact order immediately before code confirmation.

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
     AND (
       v_order.delivery_accuracy_m IS NULL
       OR v_order.delivery_accuracy_m<=100
     ) THEN
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
