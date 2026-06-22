ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL AND btrim(email) <> '';

CREATE INDEX IF NOT EXISTS idx_profiles_origem_assinatura_empresa_id
  ON public.profiles (origem_assinatura_empresa_id);

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
    v_origem := NULLIF(NEW.raw_user_meta_data->>'origem_assinatura_empresa_id','')::uuid;
  EXCEPTION WHEN others THEN
    v_origem := NULL;
  END;

  INSERT INTO public.profiles (user_id, display_name, email, phone, origem_assinatura_empresa_id)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'display_name', ''), NEW.email, ''),
    lower(COALESCE(NEW.email, '')),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    v_origem
  )
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), public.profiles.display_name),
        email = COALESCE(NULLIF(EXCLUDED.email, ''), public.profiles.email),
        phone = COALESCE(NULLIF(EXCLUDED.phone,''), public.profiles.phone),
        origem_assinatura_empresa_id = COALESCE(public.profiles.origem_assinatura_empresa_id, EXCLUDED.origem_assinatura_empresa_id),
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    origem_assinatura_empresa_id IS NULL
    OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = origem_assinatura_empresa_id)
  )
);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND (
    origem_assinatura_empresa_id IS NULL
    OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = origem_assinatura_empresa_id)
  )
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;