-- VisionFood V2 PHASE 261
-- Fix only public.pdv_catalog_v2(text).
-- Keep anon exposure intentional behind the opaque PDV session token while aligning
-- PDV product availability with the authoritative stock availability contract.

CREATE OR REPLACE FUNCTION public.pdv_catalog_v2(_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  s public.pdv_sessions%rowtype;
  h text;
  payload jsonb;
BEGIN
  h := encode(extensions.digest(coalesce(_session_token,''), 'sha256'), 'hex');

  SELECT *
    INTO s
    FROM public.pdv_sessions
   WHERE token_hash = h
     AND revoked_at IS NULL
     AND expires_at > now();

  IF s.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'price', p.price,
        'codigo_barras', p.codigo_barras,
        'available', p.available,
        'image', p.image
      )
      ORDER BY p.name
    ),
    '[]'::jsonb
  )
    INTO payload
    FROM public.products p
   WHERE p.organization_id = s.organization_id
     AND coalesce(p.available, true) = true
     AND coalesce(p.ingredient_stock_blocked, false) = false
     AND (
       coalesce(p.manage_stock, false) = false
       OR coalesce(p.stock_quantity, 0) > 0
     );

  UPDATE public.pdv_sessions
     SET last_seen_at = now()
   WHERE id = s.id;

  RETURN jsonb_build_object('ok', true, 'products', payload);
END
$function$;

REVOKE ALL ON FUNCTION public.pdv_catalog_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_catalog_v2(text) TO anon, authenticated, service_role;
