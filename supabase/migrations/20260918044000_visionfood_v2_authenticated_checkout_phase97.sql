-- Phase 97: checkout requires an authenticated customer, matching the kiosk flow.
revoke all on function public.quote_order_checkout(uuid,text,uuid,numeric,jsonb,text) from public,anon;
grant execute on function public.quote_order_checkout(uuid,text,uuid,numeric,jsonb,text) to authenticated,service_role;

revoke all on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text) from public,anon;
grant execute on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text) to authenticated,service_role;

revoke all on function public.quote_order_checkout_v2(uuid,text,uuid,numeric,jsonb,text,jsonb) from public,anon;
grant execute on function public.quote_order_checkout_v2(uuid,text,uuid,numeric,jsonb,text,jsonb) to authenticated,service_role;

revoke all on function public.create_order_checkout_v2(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb) from public,anon;
grant execute on function public.create_order_checkout_v2(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb) to authenticated,service_role;
