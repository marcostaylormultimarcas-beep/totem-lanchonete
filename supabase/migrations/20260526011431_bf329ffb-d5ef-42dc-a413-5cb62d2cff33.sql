
-- 1. system_settings: valor do plano + secret id master
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS valor_plano_padrao numeric NOT NULL DEFAULT 197.00,
  ADD COLUMN IF NOT EXISTS mp_master_token_secret_id uuid;

-- garante linha global
INSERT INTO public.system_settings (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;

-- 2. organizations: status assinatura
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS status_assinatura text NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS mp_subscription_id text,
  ADD COLUMN IF NOT EXISTS mp_next_charge_at timestamptz,
  ADD COLUMN IF NOT EXISTS mp_subscription_amount numeric;

-- valida valores aceitos
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_status_assinatura_check') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_status_assinatura_check
      CHECK (status_assinatura IN ('ativo','pendente','inadimplente','cancelado'));
  END IF;
END $$;

-- 3. RPC: salvar token master (Vault)
CREATE OR REPLACE FUNCTION public.set_master_mp_token(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.system_settings%ROWTYPE;
  v_sid uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _token IS NULL OR length(btrim(_token)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty');
  END IF;

  SELECT * INTO v_row FROM public.system_settings WHERE id = 'global';
  IF v_row.mp_master_token_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_row.mp_master_token_secret_id, _token);
    v_sid := v_row.mp_master_token_secret_id;
  ELSE
    v_sid := vault.create_secret(_token, 'mp_master_token::global', 'Mercado Pago master token (assinaturas)');
  END IF;

  UPDATE public.system_settings
    SET mp_master_token_secret_id = v_sid, updated_at = now()
    WHERE id = 'global';

  RETURN jsonb_build_object('ok', true);
END $$;

-- 4. RPC: verificar se token master existe (sem expor)
CREATE OR REPLACE FUNCTION public.has_master_mp_token()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.system_settings
    WHERE id = 'global' AND mp_master_token_secret_id IS NOT NULL
  );
$$;

-- 5. RPC interna: obter token (usada pelas edge functions com service_role)
CREATE OR REPLACE FUNCTION public.get_master_mp_token_internal()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sid uuid;
  v_token text;
BEGIN
  -- permitido para super_admin ou service_role (sem auth.uid)
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RETURN NULL;
  END IF;
  SELECT mp_master_token_secret_id INTO v_sid FROM public.system_settings WHERE id = 'global';
  IF v_sid IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE id = v_sid;
  RETURN v_token;
END $$;

-- 6. RPC: alterar valor do plano padrão (super only)
CREATE OR REPLACE FUNCTION public.set_valor_plano_padrao(_valor numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _valor IS NULL OR _valor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  UPDATE public.system_settings SET valor_plano_padrao = _valor, updated_at = now() WHERE id = 'global';
  RETURN jsonb_build_object('ok', true, 'valor', _valor);
END $$;

-- 7. RLS: dono lê status_assinatura (já coberto pelas policies existentes da tabela)
--    Permitir leitura pública do valor_plano_padrao já está OK (system_settings authenticated read).
