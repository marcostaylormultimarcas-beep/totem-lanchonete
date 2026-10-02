-- Professional delivery acceptance lifecycle.
-- Accepting/reserving an order no longer means it already left the store.
-- The assigned driver explicitly starts delivery after pickup; before pickup the
-- driver may decline with a reason. After pickup, issues are reported for owner
-- intervention rather than silently abandoning the order.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_issue_reason text,
  ADD COLUMN IF NOT EXISTS delivery_issue_at timestamptz;

CREATE TABLE IF NOT EXISTS private.delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  entregador_id uuid REFERENCES public.entregadores(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'assigned','accepted','declined','started','issue_reported','returned_to_queue','unassigned'
  )),
  actor_kind text NOT NULL CHECK (actor_kind IN ('driver','owner','system')),
  actor_user_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.delivery_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.delivery_events TO service_role;

CREATE INDEX IF NOT EXISTS delivery_events_order_created_idx
  ON private.delivery_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_events_org_created_idx
  ON private.delivery_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_events_driver_created_idx
  ON private.delivery_events(entregador_id, created_at DESC)
  WHERE entregador_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.entregador_claim_order_session(
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
  v_mode text;
  v_updated int;
  v_release_at timestamptz;
BEGIN
  v_e := public.entregador_session_driver(_session_token);
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
  IF v_order.status<>'ready' THEN RETURN jsonb_build_object('ok',false,'reason','not_ready'); END IF;

  v_release_at:=private.visionfood_schedule_release_at(v_order.organization_id,v_order.scheduled_for);
  IF v_release_at IS NOT NULL AND now()<v_release_at THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','scheduled_not_released',
      'scheduled_for',v_order.scheduled_for,'release_at',v_release_at
    );
  END IF;

  SELECT COALESCE(delivery_assignment_mode,'manual')
    INTO v_mode
  FROM public.settings
  WHERE organization_id=v_e.organization_id
  LIMIT 1;

  IF v_mode<>'free' THEN RETURN jsonb_build_object('ok',false,'reason','mode_not_free'); END IF;
  IF v_order.entregador_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason','already_taken'); END IF;

  UPDATE public.orders
     SET entregador_id=v_e.id,
         delivery_assigned_at=now(),
         delivery_started_at=NULL,
         delivery_issue_reason=NULL,
         delivery_issue_at=NULL,
         updated_at=now()
   WHERE id=_order_id
     AND organization_id=v_e.organization_id
     AND order_type IN ('delivery','viagem')
     AND status='ready'
     AND entregador_id IS NULL;

  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated=0 THEN RETURN jsonb_build_object('ok',false,'reason','order_changed'); END IF;

  INSERT INTO private.delivery_events(
    organization_id,order_id,entregador_id,event_type,actor_kind,reason
  ) VALUES (
    v_e.organization_id,_order_id,v_e.id,'accepted','driver','accepted_free_assignment'
  );

  RETURN jsonb_build_object(
    'ok',true,
    'status','ready',
    'reserved',true,
    'entregador_id',v_e.id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.entregador_claim_order_session(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entregador_claim_order_session(text,uuid) TO anon, authenticated, service_role;

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
GRANT EXECUTE ON FUNCTION public.entregador_start_delivery_session(text,uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.entregador_decline_order_session(
  _session_token text,
  _order_id uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_e public.entregadores%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reason text:=btrim(coalesce(_reason,''));
  v_mode text;
BEGIN
  v_e:=public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_session');
  END IF;

  IF length(v_reason)<3 OR length(v_reason)>300 THEN
    RETURN jsonb_build_object('ok',false,'reason','reason_required');
  END IF;

  SELECT *
    INTO v_order
  FROM public.orders
  WHERE id=_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','order_not_found'); END IF;
  IF v_order.organization_id<>v_e.organization_id THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
  IF v_order.entregador_id IS DISTINCT FROM v_e.id THEN RETURN jsonb_build_object('ok',false,'reason','not_assigned'); END IF;
  IF v_order.status='out_for_delivery' THEN RETURN jsonb_build_object('ok',false,'reason','already_picked_up'); END IF;
  IF v_order.status NOT IN ('preparing','ready') THEN
    RETURN jsonb_build_object('ok',false,'reason','status_locked','current_status',v_order.status);
  END IF;

  UPDATE public.orders
     SET entregador_id=NULL,
         delivery_assigned_at=NULL,
         delivery_started_at=NULL,
         delivery_issue_reason=NULL,
         delivery_issue_at=NULL,
         updated_at=now()
   WHERE id=v_order.id;

  INSERT INTO private.delivery_events(
    organization_id,order_id,entregador_id,event_type,actor_kind,reason
  ) VALUES (
    v_order.organization_id,v_order.id,v_e.id,'declined','driver',v_reason
  );

  SELECT COALESCE(delivery_assignment_mode,'manual')
    INTO v_mode
  FROM public.settings
  WHERE organization_id=v_order.organization_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok',true,
    'status',v_order.status,
    'assignment_mode',coalesce(v_mode,'manual'),
    'returned_to_queue',v_order.status='ready' AND coalesce(v_mode,'manual')='free'
  );
END
$function$;

REVOKE ALL ON FUNCTION public.entregador_decline_order_session(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entregador_decline_order_session(text,uuid,text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.entregador_report_delivery_issue_session(
  _session_token text,
  _order_id uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_e public.entregadores%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reason text:=btrim(coalesce(_reason,''));
BEGIN
  v_e:=public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_session');
  END IF;

  IF length(v_reason)<3 OR length(v_reason)>500 THEN
    RETURN jsonb_build_object('ok',false,'reason','reason_required');
  END IF;

  SELECT *
    INTO v_order
  FROM public.orders
  WHERE id=_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','order_not_found'); END IF;
  IF v_order.organization_id<>v_e.organization_id THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
  IF v_order.entregador_id IS DISTINCT FROM v_e.id THEN RETURN jsonb_build_object('ok',false,'reason','not_assigned'); END IF;
  IF v_order.status<>'out_for_delivery' THEN
    RETURN jsonb_build_object('ok',false,'reason','not_out_for_delivery','current_status',v_order.status);
  END IF;

  UPDATE public.orders
     SET delivery_issue_reason=v_reason,
         delivery_issue_at=now(),
         updated_at=now()
   WHERE id=v_order.id;

  INSERT INTO private.delivery_events(
    organization_id,order_id,entregador_id,event_type,actor_kind,reason
  ) VALUES (
    v_order.organization_id,v_order.id,v_e.id,'issue_reported','driver',v_reason
  );

  RETURN jsonb_build_object('ok',true,'status','out_for_delivery','issue_reported',true);
END
$function$;

REVOKE ALL ON FUNCTION public.entregador_report_delivery_issue_session(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entregador_report_delivery_issue_session(text,uuid,text) TO anon, authenticated, service_role;

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
    RETURN jsonb_build_object('ok',true,'order_id',o.id,'entregador_id',_entregador_id,'idempotent',true);
  END IF;

  IF _entregador_id IS NOT NULL THEN
    SELECT *
      INTO e
    FROM public.entregadores
    WHERE id=_entregador_id
      AND organization_id=o.organization_id
      AND coalesce(active,true)=true
      AND coalesce(ativo,true)=true;

    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','entregador_invalid'); END IF;
  END IF;

  INSERT INTO private.delivery_events(
    organization_id,order_id,entregador_id,event_type,actor_kind,actor_user_id,reason
  ) VALUES (
    o.organization_id,
    o.id,
    coalesce(_entregador_id,o.entregador_id),
    CASE WHEN _entregador_id IS NULL THEN 'unassigned' ELSE 'assigned' END,
    'owner',
    u,
    CASE WHEN _entregador_id IS NULL THEN 'owner_unassigned_before_pickup' ELSE 'owner_assigned' END
  );

  UPDATE public.orders
     SET entregador_id=_entregador_id,
         delivery_assigned_at=CASE WHEN _entregador_id IS NULL THEN NULL ELSE now() END,
         delivery_started_at=CASE WHEN _entregador_id IS NULL THEN NULL ELSE delivery_started_at END,
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

CREATE OR REPLACE FUNCTION public.visionfood_dispatch_orders(_order_ids uuid[], _entregador_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  u uuid:=auth.uid();
  e public.entregadores%ROWTYPE;
  o public.orders%ROWTYPE;
  v_expected int;
  v_seen int:=0;
  v_distinct int;
  v_release_at timestamptz;
BEGIN
  IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','unauthenticated'); END IF;

  v_expected:=coalesce(cardinality(_order_ids),0);
  IF v_expected<1 OR v_expected>200 THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_order_count');
  END IF;

  SELECT count(distinct x)::int
    INTO v_distinct
  FROM unnest(_order_ids) AS t(x);

  IF v_distinct<>v_expected THEN
    RETURN jsonb_build_object('ok',false,'reason','duplicate_order_id');
  END IF;

  SELECT *
    INTO e
  FROM public.entregadores
  WHERE id=_entregador_id
    AND coalesce(active,true)=true
    AND coalesce(ativo,true)=true;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','entregador_invalid'); END IF;
  IF NOT private.usuario_dono_org(e.organization_id,u) THEN
    RETURN jsonb_build_object('ok',false,'reason','forbidden');
  END IF;

  FOR o IN
    SELECT *
    FROM public.orders
    WHERE id=any(_order_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    v_seen:=v_seen+1;

    IF o.organization_id IS DISTINCT FROM e.organization_id THEN
      RETURN jsonb_build_object('ok',false,'reason','cross_organization_order','order_id',o.id);
    END IF;
    IF o.order_type NOT IN ('delivery','viagem') THEN
      RETURN jsonb_build_object('ok',false,'reason','not_delivery_order','order_id',o.id);
    END IF;
    IF o.status<>'ready' THEN
      RETURN jsonb_build_object('ok',false,'reason','status_changed','order_id',o.id,'current_status',o.status);
    END IF;

    v_release_at:=private.visionfood_schedule_release_at(o.organization_id,o.scheduled_for);
    IF v_release_at IS NOT NULL AND now()<v_release_at THEN
      RETURN jsonb_build_object(
        'ok',false,'reason','scheduled_not_released',
        'order_id',o.id,'scheduled_for',o.scheduled_for,'release_at',v_release_at
      );
    END IF;

    IF o.entregador_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok',false,'reason','already_assigned','order_id',o.id,'entregador_id',o.entregador_id
      );
    END IF;
  END LOOP;

  IF v_seen<>v_expected THEN
    RETURN jsonb_build_object('ok',false,'reason','order_not_found');
  END IF;

  UPDATE public.orders
     SET entregador_id=_entregador_id,
         delivery_assigned_at=now(),
         delivery_started_at=NULL,
         delivery_issue_reason=NULL,
         delivery_issue_at=NULL,
         updated_at=now()
   WHERE id=any(_order_ids);

  INSERT INTO private.delivery_events(
    organization_id,order_id,entregador_id,event_type,actor_kind,actor_user_id,reason
  )
  SELECT
    e.organization_id,x,_entregador_id,'assigned','owner',u,'route_assignment'
  FROM unnest(_order_ids) AS x;

  RETURN jsonb_build_object(
    'ok',true,
    'count',v_expected,
    'entregador_id',_entregador_id,
    'status','ready',
    'reserved',true
  );
END
$function$;

REVOKE ALL ON FUNCTION public.visionfood_dispatch_orders(uuid[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visionfood_dispatch_orders(uuid[],uuid) TO authenticated, service_role;

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
        'customer_phone',o.customer_phone,
        'delivery_address',o.delivery_address,
        'delivery_reference',o.delivery_reference,
        'delivery_recipient',o.delivery_recipient,
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
GRANT EXECUTE ON FUNCTION public.entregador_orders_session(text) TO anon, authenticated, service_role;
