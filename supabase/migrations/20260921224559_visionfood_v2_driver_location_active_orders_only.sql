-- Stop order-bound driver tracking as soon as the order is no longer active.

CREATE OR REPLACE FUNCTION public.entregador_update_location_session(
  _session_token text,
  _lat numeric,
  _lng numeric,
  _order_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_e public.entregadores%ROWTYPE;
BEGIN
  v_e:=public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_session');
  END IF;

  IF _lat IS NULL OR _lng IS NULL
     OR _lat < -90 OR _lat > 90
     OR _lng < -180 OR _lng > 180 THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_location');
  END IF;

  IF _order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id=_order_id
      AND o.organization_id=v_e.organization_id
      AND o.entregador_id=v_e.id
      AND o.status IN ('preparing','ready','out_for_delivery')
  ) THEN
    RETURN jsonb_build_object('ok',false,'reason','order_not_assigned');
  END IF;

  UPDATE public.entregadores
     SET ultima_lat=_lat,
         ultima_lng=_lng,
         ultima_localizacao_at=now(),
         ultima_localizacao_pedido_id=_order_id,
         updated_at=now()
   WHERE id=v_e.id;

  RETURN jsonb_build_object('ok',true);
END
$function$;

REVOKE ALL ON FUNCTION public.entregador_update_location_session(text,numeric,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entregador_update_location_session(text,numeric,numeric,uuid)
  TO anon, authenticated, service_role;
