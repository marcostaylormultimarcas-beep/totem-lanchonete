-- VisionFood V2 — Entregador revocable token sessions (phase 36)
-- Additive migration. Frontend cutover must happen together with this migration.

CREATE TABLE IF NOT EXISTS public.entregador_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entregador_id uuid NOT NULL REFERENCES public.entregadores(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entregador_sessions_driver_active
  ON public.entregador_sessions(entregador_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.entregador_sessions ENABLE ROW LEVEL SECURITY;
-- Intentionally no direct client policies. Access is only through SECURITY DEFINER RPCs.
REVOKE ALL ON TABLE public.entregador_sessions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.entregador_session_driver(_token text)
RETURNS public.entregadores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_e public.entregadores%ROWTYPE;
BEGIN
  IF _token IS NULL OR length(_token) < 32 THEN RETURN NULL; END IF;
  SELECT e.* INTO v_e
  FROM public.entregador_sessions s
  JOIN public.entregadores e ON e.id=s.entregador_id AND e.organization_id=s.organization_id
  WHERE s.token_hash=encode(digest(_token,'sha256'),'hex')
    AND s.revoked_at IS NULL
    AND s.expires_at>now()
    -- Production currently contains both legacy `ativo` and newer `active`.
    -- A driver is accepted unless either populated flag explicitly disables it.
    AND COALESCE(e.active,true)=true
    AND COALESCE(e.ativo,true)=true
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.entregador_sessions SET last_used_at=now()
  WHERE token_hash=encode(digest(_token,'sha256'),'hex') AND revoked_at IS NULL;
  RETURN v_e;
END;
$$;

REVOKE ALL ON FUNCTION public.entregador_session_driver(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.entregador_login_session(_org_slug text,_username text,_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_login jsonb; v_token text; v_driver_id uuid; v_org_id uuid;
BEGIN
  v_login:=public.entregador_login(_org_slug,_username,_password);
  IF COALESCE((v_login->>'ok')::boolean,false) IS NOT TRUE THEN RETURN v_login; END IF;
  v_driver_id:=(v_login->'entregador'->>'id')::uuid;
  v_org_id:=(v_login->'entregador'->>'organization_id')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM public.entregadores e
    WHERE e.id=v_driver_id AND e.organization_id=v_org_id
      AND COALESCE(e.active,true)=true AND COALESCE(e.ativo,true)=true
  ) THEN
    RETURN jsonb_build_object('ok',false,'reason','inactive_driver');
  END IF;
  v_token:=encode(gen_random_bytes(32),'hex');
  INSERT INTO public.entregador_sessions(entregador_id,organization_id,token_hash)
  VALUES(v_driver_id,v_org_id,encode(digest(v_token,'sha256'),'hex'));
  RETURN v_login || jsonb_build_object('session_token',v_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.entregador_logout_session(_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF _session_token IS NOT NULL THEN
    UPDATE public.entregador_sessions SET revoked_at=now()
    WHERE token_hash=encode(digest(_session_token,'sha256'),'hex') AND revoked_at IS NULL;
  END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;

REVOKE ALL ON FUNCTION public.entregador_login_session(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.entregador_logout_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entregador_login_session(text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.entregador_logout_session(text) TO anon,authenticated;
