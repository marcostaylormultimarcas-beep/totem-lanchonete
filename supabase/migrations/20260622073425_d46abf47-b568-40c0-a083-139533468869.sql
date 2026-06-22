CREATE OR REPLACE FUNCTION public.email_already_registered(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE lower(p.email) = lower(btrim(_email))
  )
  OR EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE lower(u.email) = lower(btrim(_email))
  );
$$;

REVOKE ALL ON FUNCTION public.email_already_registered(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_already_registered(text) TO anon, authenticated, service_role;