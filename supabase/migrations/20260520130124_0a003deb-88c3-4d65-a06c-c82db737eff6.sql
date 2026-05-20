-- 1. Vault extension (Supabase managed)
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- 2. New columns on settings storing only the vault secret UUIDs
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS mp_access_token_secret_id uuid,
  ADD COLUMN IF NOT EXISTS mp_client_id_secret_id uuid,
  ADD COLUMN IF NOT EXISTS mp_public_key_secret_id uuid;

-- 3. Helper: ensure caller owns the org (or is super admin)
CREATE OR REPLACE FUNCTION public.user_owns_org(_org uuid, _uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(_uid)
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = _org
          AND (o.owner_id = _uid OR (public.is_master_admin(_uid) AND o.master_id = _uid))
      );
$$;

-- 4. Setter: writes the three secrets to Vault, stores only UUIDs in settings
CREATE OR REPLACE FUNCTION public.set_mp_credentials(
  _org uuid,
  _access_token text,
  _client_id text,
  _public_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.settings%ROWTYPE;
  v_at_id uuid;
  v_ci_id uuid;
  v_pk_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF NOT public.user_owns_org(_org, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_row FROM public.settings WHERE organization_id = _org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_settings_row');
  END IF;

  -- Access Token
  IF _access_token IS NOT NULL AND length(_access_token) > 0 THEN
    IF v_row.mp_access_token_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_row.mp_access_token_secret_id, _access_token);
      v_at_id := v_row.mp_access_token_secret_id;
    ELSE
      v_at_id := vault.create_secret(_access_token, 'mp_access_token::' || _org::text, 'MP access token for org ' || _org::text);
    END IF;
  ELSE
    v_at_id := v_row.mp_access_token_secret_id;
  END IF;

  -- Client ID
  IF _client_id IS NOT NULL AND length(_client_id) > 0 THEN
    IF v_row.mp_client_id_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_row.mp_client_id_secret_id, _client_id);
      v_ci_id := v_row.mp_client_id_secret_id;
    ELSE
      v_ci_id := vault.create_secret(_client_id, 'mp_client_id::' || _org::text, 'MP client id for org ' || _org::text);
    END IF;
  ELSE
    v_ci_id := v_row.mp_client_id_secret_id;
  END IF;

  -- Public Key
  IF _public_key IS NOT NULL AND length(_public_key) > 0 THEN
    IF v_row.mp_public_key_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_row.mp_public_key_secret_id, _public_key);
      v_pk_id := v_row.mp_public_key_secret_id;
    ELSE
      v_pk_id := vault.create_secret(_public_key, 'mp_public_key::' || _org::text, 'MP public key for org ' || _org::text);
    END IF;
  ELSE
    v_pk_id := v_row.mp_public_key_secret_id;
  END IF;

  UPDATE public.settings
    SET mp_access_token_secret_id = v_at_id,
        mp_client_id_secret_id    = v_ci_id,
        mp_public_key_secret_id   = v_pk_id,
        mp_access_token = '',
        mp_public_key   = '',
        updated_at = now()
    WHERE organization_id = _org;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_mp_credentials(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_mp_credentials(uuid, text, text, text) TO authenticated;

-- 5. Getter para o admin: devolve os 3 valores se for o dono
CREATE OR REPLACE FUNCTION public.get_mp_credentials_for_owner(_org uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.settings%ROWTYPE;
  v_at text; v_ci text; v_pk text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF NOT public.user_owns_org(_org, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_row FROM public.settings WHERE organization_id = _org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_settings_row');
  END IF;

  IF v_row.mp_access_token_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_at FROM vault.decrypted_secrets WHERE id = v_row.mp_access_token_secret_id;
  END IF;
  IF v_row.mp_client_id_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_ci FROM vault.decrypted_secrets WHERE id = v_row.mp_client_id_secret_id;
  END IF;
  IF v_row.mp_public_key_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_pk FROM vault.decrypted_secrets WHERE id = v_row.mp_public_key_secret_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'access_token', COALESCE(v_at, ''),
    'client_id',    COALESCE(v_ci, ''),
    'public_key',   COALESCE(v_pk, '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mp_credentials_for_owner(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_mp_credentials_for_owner(uuid) TO authenticated;

-- 6. Getter interno para a edge function (service role): só access_token
CREATE OR REPLACE FUNCTION public.get_mp_access_token_internal(_org uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_token text;
BEGIN
  SELECT mp_access_token_secret_id INTO v_id FROM public.settings WHERE organization_id = _org;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE id = v_id;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mp_access_token_internal(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mp_access_token_internal(uuid) TO service_role;

-- 7. Migra tokens já existentes em texto puro para o Vault
DO $$
DECLARE
  r RECORD;
  v_id uuid;
BEGIN
  FOR r IN
    SELECT organization_id, mp_access_token, mp_public_key
    FROM public.settings
    WHERE (mp_access_token IS NOT NULL AND length(mp_access_token) > 0 AND mp_access_token_secret_id IS NULL)
       OR (mp_public_key   IS NOT NULL AND length(mp_public_key)   > 0 AND mp_public_key_secret_id   IS NULL)
  LOOP
    IF r.mp_access_token IS NOT NULL AND length(r.mp_access_token) > 0 THEN
      v_id := vault.create_secret(r.mp_access_token, 'mp_access_token::' || r.organization_id::text, 'migrated');
      UPDATE public.settings SET mp_access_token_secret_id = v_id, mp_access_token = '' WHERE organization_id = r.organization_id;
    END IF;
    IF r.mp_public_key IS NOT NULL AND length(r.mp_public_key) > 0 THEN
      v_id := vault.create_secret(r.mp_public_key, 'mp_public_key::' || r.organization_id::text, 'migrated');
      UPDATE public.settings SET mp_public_key_secret_id = v_id, mp_public_key = '' WHERE organization_id = r.organization_id;
    END IF;
  END LOOP;
END $$;