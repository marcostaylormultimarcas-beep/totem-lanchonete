-- Audit follow-up for the professional delivery lifecycle.
-- Prevents normal admin status changes from bypassing the delivery code,
-- preserves reassignment history, and prevents deletion of drivers referenced
-- by the private audit trail.

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
     AND _next_status IN ('preparing','out_for_delivery') THEN
    RETURN jsonb_build_object(
      'ok',false,
      'reason','scheduled_not_released',
      'scheduled_for',o.scheduled_for,
      'release_at',v_release_at
    );
  END IF;

  IF o.status='ready'
     AND o.order_type IN ('delivery','viagem')
     AND _next_status='out_for_delivery'
     AND o.entregador_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','driver_required');
  END IF;

  IF o.status='out_for_delivery'
     AND o.order_type IN ('delivery','viagem')
     AND _next_status='delivered' THEN
    RETURN jsonb_build_object('ok',false,'reason','delivery_code_required');
  END IF;

  v_allowed:=CASE
    WHEN o.status='pending' THEN _next_status='preparing'
    WHEN o.status='preparing' THEN _next_status='ready'
    WHEN o.status='ready' AND o.order_type IN ('delivery','viagem')
      THEN _next_status='out_for_delivery'
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

CREATE OR REPLACE FUNCTION public.assign_entregador(_order_id uuid, _entregador_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  u uuid:=auth.uid();
  o public.orders%ROWTYPE;
  e public.entregadores%ROWTYPE;
BEGIN
  IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','unauthenticated'); END IF;

  SELECT *
    INTO o
  FROM public.orders
  WHERE id=_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','order_not_found'); END IF;

  IF NOT private.usuario_dono_org(o.organization_id,u) AND NOT private.eh_super_admin(u) THEN
    RETURN jsonb_build_object('ok',false,'reason','forbidden');
  END IF;

  IF o.order_type NOT IN ('delivery','viagem') THEN
    RETURN jsonb_build_object('ok',false,'reason','not_delivery_order');
  END IF;

  IF o.status IN ('delivered','cancelled') THEN
    RETURN jsonb_build_object('ok',false,'reason','status_locked');
  END IF;

  IF o.status='out_for_delivery' AND o.entregador_id IS DISTINCT FROM _entregador_id THEN
    RETURN jsonb_build_object('ok',false,'reason','delivery_in_progress');
  END IF;

  IF o.entregador_id IS NOT DISTINCT FROM _entregador_id THEN
    RETURN jsonb_build_object(
      'ok',true,'order_id',o.id,'entregador_id',_entregador_id,'idempotent',true
    );
  END IF;

  IF _entregador_id IS NOT NULL THEN
    SELECT *
      INTO e
    FROM public.entregadores
    WHERE id=_entregador_id
      AND organization_id=o.organization_id
      AND coalesce(active,true)=true
      AND coalesce(ativo,true)=true;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'reason','entregador_invalid');
    END IF;
  END IF;

  IF o.entregador_id IS NOT NULL THEN
    INSERT INTO private.delivery_events(
      organization_id,order_id,entregador_id,event_type,actor_kind,actor_user_id,reason
    ) VALUES (
      o.organization_id,
      o.id,
      o.entregador_id,
      'unassigned',
      'owner',
      u,
      CASE
        WHEN _entregador_id IS NULL THEN 'owner_unassigned_before_pickup'
        ELSE 'owner_reassigned_before_pickup'
      END
    );
  END IF;

  IF _entregador_id IS NOT NULL THEN
    INSERT INTO private.delivery_events(
      organization_id,order_id,entregador_id,event_type,actor_kind,actor_user_id,reason
    ) VALUES (
      o.organization_id,o.id,_entregador_id,'assigned','owner',u,'owner_assigned'
    );
  END IF;

  UPDATE public.orders
     SET entregador_id=_entregador_id,
         delivery_assigned_at=CASE WHEN _entregador_id IS NULL THEN NULL ELSE now() END,
         delivery_started_at=CASE WHEN o.status IN ('preparing','ready') THEN NULL ELSE delivery_started_at END,
         delivery_issue_reason=CASE WHEN o.status IN ('preparing','ready') THEN NULL ELSE delivery_issue_reason END,
         delivery_issue_at=CASE WHEN o.status IN ('preparing','ready') THEN NULL ELSE delivery_issue_at END,
         updated_at=now()
   WHERE id=o.id;

  RETURN jsonb_build_object(
    'ok',true,'order_id',o.id,'entregador_id',_entregador_id,'idempotent',false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.assign_entregador(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_entregador(uuid,uuid) TO authenticated, service_role;

ALTER TABLE private.delivery_events
  DROP CONSTRAINT IF EXISTS delivery_events_entregador_id_fkey;

ALTER TABLE private.delivery_events
  ADD CONSTRAINT delivery_events_entregador_id_fkey
  FOREIGN KEY (entregador_id)
  REFERENCES public.entregadores(id)
  ON DELETE RESTRICT;
