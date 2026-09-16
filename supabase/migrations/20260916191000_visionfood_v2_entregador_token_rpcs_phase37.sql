-- VisionFood V2 — token-authenticated driver operations (phase 37)
-- Additive: legacy password RPCs remain temporarily for rollback compatibility.

CREATE OR REPLACE FUNCTION public.entregador_orders_session(_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_e public.entregadores%ROWTYPE; v_rows jsonb;
BEGIN
  v_e := public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(o.*) ORDER BY o.created_at DESC),'[]'::jsonb) INTO v_rows
  FROM public.orders o WHERE o.organization_id=v_e.organization_id AND o.entregador_id=v_e.id
    AND o.status IN ('preparing','out_for_delivery','ready','delivered') AND o.created_at > now()-interval '7 days';
  RETURN jsonb_build_object('ok',true,'orders',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.entregador_available_orders_session(_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_e public.entregadores%ROWTYPE; v_mode text; v_rows jsonb;
BEGIN
  v_e := public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;
  SELECT COALESCE(delivery_assignment_mode,'manual') INTO v_mode FROM public.settings WHERE organization_id=v_e.organization_id LIMIT 1;
  IF v_mode <> 'free' THEN RETURN jsonb_build_object('ok',true,'mode',COALESCE(v_mode,'manual'),'orders','[]'::jsonb); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(o.*) ORDER BY o.created_at ASC),'[]'::jsonb) INTO v_rows
  FROM public.orders o WHERE o.organization_id=v_e.organization_id AND o.order_type IN ('delivery','viagem')
    AND o.entregador_id IS NULL AND o.status IN ('preparing','ready','out_for_delivery') AND o.created_at > now()-interval '1 day';
  RETURN jsonb_build_object('ok',true,'mode',v_mode,'orders',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.entregador_claim_order_session(_session_token text,_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_e public.entregadores%ROWTYPE; v_order public.orders%ROWTYPE; v_mode text; v_updated int;
BEGIN
  v_e := public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','order_not_found'); END IF;
  IF v_order.organization_id<>v_e.organization_id THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
  SELECT COALESCE(delivery_assignment_mode,'manual') INTO v_mode FROM public.settings WHERE organization_id=v_e.organization_id LIMIT 1;
  IF v_mode<>'free' THEN RETURN jsonb_build_object('ok',false,'reason','mode_not_free'); END IF;
  IF v_order.entregador_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason','already_taken'); END IF;
  UPDATE public.orders SET entregador_id=v_e.id,updated_at=now() WHERE id=_order_id AND entregador_id IS NULL;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated=0 THEN RETURN jsonb_build_object('ok',false,'reason','already_taken'); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.entregador_update_location_session(_session_token text,_lat numeric,_lng numeric,_order_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_e public.entregadores%ROWTYPE;
BEGIN
  v_e := public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;
  UPDATE public.entregadores SET last_lat=_lat,last_lng=_lng,last_location_at=now(),last_location_order_id=_order_id,updated_at=now() WHERE id=v_e.id;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_delivery_with_code_session(_session_token text,_order_id uuid,_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_e public.entregadores%ROWTYPE; v_order public.orders%ROWTYPE;
BEGIN
  v_e := public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','order_not_found'); END IF;
  IF v_order.organization_id<>v_e.organization_id THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
  IF v_order.entregador_id IS DISTINCT FROM v_e.id THEN RETURN jsonb_build_object('ok',false,'reason','not_assigned'); END IF;
  IF v_order.status='delivered' THEN RETURN jsonb_build_object('ok',false,'reason','already_delivered'); END IF;
  IF v_order.status='cancelled' THEN RETURN jsonb_build_object('ok',false,'reason','cancelled'); END IF;
  IF COALESCE(v_order.delivery_code,'')='' OR v_order.delivery_code<>_code THEN RETURN jsonb_build_object('ok',false,'reason','invalid_code'); END IF;
  UPDATE public.orders SET status='delivered',updated_at=now() WHERE id=_order_id;
  INSERT INTO public.entregas_log(order_id,organization_id,entregador_id,delivered_at) VALUES(_order_id,v_order.organization_id,v_e.id,now());
  RETURN jsonb_build_object('ok',true);
END $$;

GRANT EXECUTE ON FUNCTION public.entregador_orders_session(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.entregador_available_orders_session(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.entregador_claim_order_session(text,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.entregador_update_location_session(text,numeric,numeric,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_delivery_with_code_session(text,uuid,text) TO anon,authenticated;
