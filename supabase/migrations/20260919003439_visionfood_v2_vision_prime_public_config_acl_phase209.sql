-- Phase 209: make the intentional public Vision Prime config RPC reproducible.
-- The RPC stays SECURITY DEFINER because storefront callers (including anon)
-- must read a curated subset while direct table access remains protected.
alter function public.vision_prime_public_config(uuid) owner to postgres;
alter function public.vision_prime_public_config(uuid) security definer;
alter function public.vision_prime_public_config(uuid) stable;
alter function public.vision_prime_public_config(uuid) set search_path to '';

revoke execute on function public.vision_prime_public_config(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.vision_prime_public_config(uuid)
  to anon, authenticated, service_role;
