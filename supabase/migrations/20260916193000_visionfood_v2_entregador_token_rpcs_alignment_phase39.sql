-- VisionFood V2 — production-schema aligned token RPCs (phase 39)
-- Replaces phase 37 definitions after phase 38 creates required order/log fields.

CREATE OR REPLACE FUNCTION public.entregador_update_location_session(_session_token text,_lat numeric,_lng numeric,_order_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_e public.entregadores%ROWTYPE;
BEGIN
  v_e := public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;
  IF _lat IS NULL OR _lng IS NULL OR _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_location');
  END IF;
  IF _order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id=_order_id AND o.organization_id=v_e.organization_id AND o.entregador_id=v_e.id
  ) THEN
    RETURN jsonb_build_object('ok',false,'reason','order_not_assigned');
  END IF;
  UPDATE public.entregadores
  SET ultima_lat=_lat, ultima_lng=_lng, ultima_localizacao_at=now(),
      ultima_localizacao_pedido_id=_order_id, updated_at=now()
  WHERE id=v_e.id;
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
  INSERT INTO public.entregas_log(order_id,organization_id,entregador_id,delivered_at)
  VALUES(_order_id,v_order.organization_id,v_e.id,now())
  ON CONFLICT (order_id) DO NOTHING;
  RETURN jsonb_build_object('ok',true);
END $$;

REVOKE ALL ON FUNCTION public.entregador_update_location_session(text,numeric,numeric,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_delivery_with_code_session(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entregador_update_location_session(text,numeric,numeric,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_delivery_with_code_session(text,uuid,text) TO anon,authenticated;
