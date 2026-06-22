
-- 1) Permite que owners/master/super vejam perfis dos clientes vinculados à sua loja (origem_assinatura_empresa_id)
DROP POLICY IF EXISTS "Org owners can view linked profiles" ON public.profiles;
CREATE POLICY "Org owners can view linked profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  origem_assinatura_empresa_id IS NOT NULL
  AND public.user_owns_org(origem_assinatura_empresa_id, auth.uid())
);

-- 2) Trigger handle_new_user agora também grava origem_assinatura_empresa_id vindo do raw_user_meta_data
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

  INSERT INTO public.profiles (user_id, display_name, phone, origem_assinatura_empresa_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    v_origem
  )
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        phone = COALESCE(NULLIF(EXCLUDED.phone,''), public.profiles.phone),
        origem_assinatura_empresa_id = COALESCE(public.profiles.origem_assinatura_empresa_id, EXCLUDED.origem_assinatura_empresa_id);
  RETURN NEW;
END;
$$;
