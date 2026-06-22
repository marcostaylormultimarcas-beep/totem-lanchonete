
-- Fix permission denied: grant execute to anon + authenticated, and simplify RLS policy on entregadores using user_owns_org (already accessible to all roles).
GRANT EXECUTE ON FUNCTION public.is_master_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_owns_org(uuid, uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "entregadores owner manage" ON public.entregadores;

CREATE POLICY "entregadores owner select"
ON public.entregadores FOR SELECT
TO authenticated
USING (public.user_owns_org(organization_id, auth.uid()));

CREATE POLICY "entregadores owner insert"
ON public.entregadores FOR INSERT
TO authenticated
WITH CHECK (public.user_owns_org(organization_id, auth.uid()));

CREATE POLICY "entregadores owner update"
ON public.entregadores FOR UPDATE
TO authenticated
USING (public.user_owns_org(organization_id, auth.uid()))
WITH CHECK (public.user_owns_org(organization_id, auth.uid()));

CREATE POLICY "entregadores owner delete"
ON public.entregadores FOR DELETE
TO authenticated
USING (public.user_owns_org(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entregadores TO authenticated;
GRANT ALL ON public.entregadores TO service_role;
