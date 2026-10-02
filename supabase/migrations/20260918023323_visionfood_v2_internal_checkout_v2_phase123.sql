
revoke execute on function public.create_order_checkout_v2(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) from public,anon,authenticated;

grant execute on function public.create_order_checkout_v2(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) to service_role;
