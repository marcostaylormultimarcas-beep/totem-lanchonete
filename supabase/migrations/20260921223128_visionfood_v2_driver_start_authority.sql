-- Enforce that an assigned driver, not the normal admin status RPC, confirms
-- physical pickup/start. Delivery completion remains code+driver-session based.

CREATE OR REPLACE FUNCTION public.visionfood_update_order_status(
  _order_id uuid,
  _expected_status text,
  _next_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  u uuid:=auth.uid();
  o public.orders%rowtype;
  v_allowed boolean:=false;
  v_release_at timestamptz;
BEGIN
  IF u IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','unauthenticated');
  END IF;

  SELECT *
    INTO o
  FROM public.orders
  WHERE id=_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','not_found');
  END IF;

  IF NOT private.usuario_dono_org(o.organization_id,u) THEN
    RETURN jsonb_build_object('ok',false,'reason','forbidden');
  END IF;

  IF _expected_status IS NULL OR o.status IS DISTINCT FROM _expected_status THEN
    RETURN jsonb_build_object('ok',false,'reason','status_changed','current_status',o.status);
  END IF;

  IF _next_status IS NULL OR _next_status=_expected_status THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_transition');
  END IF;

  v_release_at:=private.visionfood_schedule_release_at(o.organization_id,o.scheduled_for);
  IF v_release_at IS NOT NULL
     AND now()<v_release_at
     AND _next_status='preparing' THEN
    RETURN jsonb_build_object(
      'ok',false,
      'reason','scheduled_not_released',
      'scheduled_for',o.scheduled_for,
      'release_at',v_release_at
    );
  END IF;

  IF o.order_type IN ('delivery','viagem')
     AND o.status='ready'
     AND _next_status='out_for_delivery' THEN
    RETURN jsonb_build_object('ok',false,'reason','driver_start_required');
  END IF;

  IF o.order_type IN ('delivery','viagem')
     AND o.status='out_for_delivery'
     AND _next_status='delivered' THEN
    RETURN jsonb_build_object('ok',false,'reason','delivery_code_required');
  END IF;

  v_allowed:=CASE
    WHEN o.status='pending' THEN _next_status='preparing'
    WHEN o.status='preparing' THEN _next_status='ready'
    WHEN o.status='ready' AND o.order_type NOT IN ('delivery','viagem')
      THEN _next_status='delivered'
    ELSE false
  END;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','invalid_transition',
      'current_status',o.status,'requested_status',_next_status
    );
  END IF;

  UPDATE public.orders
     SET status=_next_status,updated_at=now()
   WHERE id=o.id;

  RETURN jsonb_build_object(
    'ok',true,'order_id',o.id,'previous_status',o.status,'status',_next_status
  );
END
$function$;

REVOKE ALL ON FUNCTION public.visionfood_update_order_status(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visionfood_update_order_status(uuid,text,text) TO authenticated, service_role;
