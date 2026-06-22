ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid;

CREATE INDEX IF NOT EXISTS idx_profiles_organization_id
  ON public.profiles (organization_id);

UPDATE public.profiles
SET organization_id = origem_assinatura_empresa_id,
    updated_at = now()
WHERE organization_id IS NULL
  AND origem_assinatura_empresa_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_origem uuid;
BEGIN
  BEGIN
    v_origem := NULLIF(NEW.raw_user_meta_data->>'organization_id','')::uuid;
  EXCEPTION WHEN others THEN
    v_origem := NULL;
  END;

  IF v_origem IS NULL THEN
    BEGIN
      v_origem := NULLIF(NEW.raw_user_meta_data->>'origem_assinatura_empresa_id','')::uuid;
    EXCEPTION WHEN others THEN
      v_origem := NULL;
    END;
  END IF;

  INSERT INTO public.profiles (user_id, display_name, email, phone, organization_id, origem_assinatura_empresa_id)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'display_name', ''), NEW.email, ''),
    lower(COALESCE(NEW.email, '')),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    v_origem,
    v_origem
  )
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), public.profiles.display_name),
        email = COALESCE(NULLIF(EXCLUDED.email, ''), public.profiles.email),
        phone = COALESCE(NULLIF(EXCLUDED.phone,''), public.profiles.phone),
        organization_id = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id, public.profiles.origem_assinatura_empresa_id),
        origem_assinatura_empresa_id = COALESCE(public.profiles.origem_assinatura_empresa_id, EXCLUDED.origem_assinatura_empresa_id, public.profiles.organization_id),
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Org owners can view linked profiles" ON public.profiles;
CREATE POLICY "Org owners can view linked profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  (organization_id IS NOT NULL AND public.user_owns_org(organization_id, auth.uid()))
  OR (origem_assinatura_empresa_id IS NOT NULL AND public.user_owns_org(origem_assinatura_empresa_id, auth.uid()))
);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (organization_id IS NULL OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = organization_id))
  AND (origem_assinatura_empresa_id IS NULL OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = origem_assinatura_empresa_id))
);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND (organization_id IS NULL OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = organization_id))
  AND (origem_assinatura_empresa_id IS NULL OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = origem_assinatura_empresa_id))
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;