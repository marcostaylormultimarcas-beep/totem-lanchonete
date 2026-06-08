
ALTER TABLE public.entregadores
  ADD COLUMN IF NOT EXISTS last_lat numeric,
  ADD COLUMN IF NOT EXISTS last_lng numeric,
  ADD COLUMN IF NOT EXISTS last_location_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_location_order_id uuid;

ALTER TABLE public.entregadores REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'entregadores'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.entregadores';
  END IF;
END $$;

-- Allow admin/owner to read live location (already covered by owner manage policy).
-- Add explicit grant for anon? No — admin is authenticated. Keep as-is.

CREATE OR REPLACE FUNCTION public.entregador_update_location(
  _entregador_id uuid,
  _password text,
  _lat numeric,
  _lng numeric,
  _order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.entregadores
    WHERE id = _entregador_id AND password = _password AND active = true
  ) INTO v_ok;

  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  END IF;

  UPDATE public.entregadores
  SET last_lat = _lat,
      last_lng = _lng,
      last_location_at = now(),
      last_location_order_id = _order_id,
      updated_at = now()
  WHERE id = _entregador_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.entregador_update_location(uuid, text, numeric, numeric, uuid) TO anon, authenticated;
