-- Allow out_for_delivery -> ready only through the authorized owner recovery
-- RPC. Direct status mutations remain rejected by the global transition guard.

CREATE OR REPLACE FUNCTION public.visionfood_guard_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_allowed boolean:=false;
  v_age_seconds numeric;
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
    WHEN old.status='ready'
         AND old.order_type NOT IN ('delivery','viagem')
      THEN new.status='delivered'
    WHEN old.status='out_for_delivery'
         AND old.order_type IN ('delivery','viagem')
      THEN (
        new.status='delivered'
        AND new.entregador_id IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.visionfood_return_delivery_to_queue(
  _order_id uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  u uuid:=auth.uid();
  o public.orders%ROWTYPE;
  v_reason text:=btrim(coalesce(_reason,''));
BEGIN
  IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','unauthenticated'); END IF;
  IF length(v_reason)<3 OR length(v_reason)>500 THEN
    RETURN jsonb_build_object('ok',false,'reason','reason_required');
  END IF;

  SELECT *
    INTO o
  FROM public.orders
  WHERE id=_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
  IF NOT private.usuario_dono_org(o.organization_id,u) AND NOT private.eh_super_admin(u) THEN
    RETURN jsonb_build_object('ok',false,'reason','forbidden');
  END IF;
  IF o.order_type NOT IN ('delivery','viagem') THEN
    RETURN jsonb_build_object('ok',false,'reason','not_delivery');
  END IF;
  IF o.status<>'out_for_delivery' THEN
    RETURN jsonb_build_object('ok',false,'reason','not_out_for_delivery','current_status',o.status);
  END IF;
  IF o.entregador_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','driver_missing');
  END IF;

  INSERT INTO private.delivery_events(
    organization_id,order_id,entregador_id,event_type,actor_kind,actor_user_id,reason
  ) VALUES (
    o.organization_id,o.id,o.entregador_id,'returned_to_queue','owner',u,v_reason
  );

  PERFORM pg_catalog.set_config('visionfood.delivery_return_authorized','1',true);

  UPDATE public.orders
     SET status='ready',
         entregador_id=NULL,
         delivery_assigned_at=NULL,
         delivery_started_at=NULL,
         delivery_issue_reason=NULL,
         delivery_issue_at=NULL,
         updated_at=now()
   WHERE id=o.id;

  RETURN jsonb_build_object('ok',true,'status','ready','returned_to_queue',true);
END
$function$;

REVOKE ALL ON FUNCTION public.visionfood_return_delivery_to_queue(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visionfood_return_delivery_to_queue(uuid,text) TO authenticated, service_role;
