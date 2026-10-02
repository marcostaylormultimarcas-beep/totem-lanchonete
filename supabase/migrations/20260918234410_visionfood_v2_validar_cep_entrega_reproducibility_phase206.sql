-- Phase 206: make the installed validar_cep_entrega RPC ACL reproducible.
-- The RPC is intentionally public to anon/authenticated for storefront checkout.
-- Reassert the exact installed executor set without changing the function body.

revoke execute on function public.validar_cep_entrega(uuid,text,numeric,numeric)
from public, anon, authenticated, service_role;

grant execute on function public.validar_cep_entrega(uuid,text,numeric,numeric)
to anon, authenticated, service_role;
