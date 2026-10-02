-- Phase 46C: disable legacy Vision Prime self-activation until payment proof exists.
revoke execute on function public.vision_prime_subscribe(uuid) from public, anon, authenticated;
comment on function public.vision_prime_subscribe(uuid) is
'Legacy simulated subscription endpoint. Execution revoked in Phase 46C because it activates paid Prime benefits without payment proof. Keep disabled until a trusted payment/admin activation flow is implemented.';
