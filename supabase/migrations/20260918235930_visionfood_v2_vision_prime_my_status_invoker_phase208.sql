-- Phase 208: run Vision Prime status lookup with caller privileges.
-- The authenticated role already has SELECT on vision_prime_assinaturas,
-- protected by RLS (user_id = auth.uid()), so SECURITY DEFINER is unnecessary.
alter function public.vision_prime_my_status(uuid) security invoker;
alter function public.vision_prime_my_status(uuid) set search_path to '';

revoke all on function public.vision_prime_my_status(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.vision_prime_my_status(uuid)
  to authenticated, service_role;
