-- Phase 74: an anonymous order UUID is not an authorization credential.
revoke execute on function public.parceria_generate_for_order(uuid) from anon;
grant execute on function public.parceria_generate_for_order(uuid) to authenticated;
