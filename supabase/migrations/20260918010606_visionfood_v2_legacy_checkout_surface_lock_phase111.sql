
revoke execute on function public.quote_order_checkout(
  uuid,text,uuid,numeric,jsonb,text
) from public,anon,authenticated;

revoke execute on function public.create_order_checkout(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text
) from public,anon,authenticated;

grant execute on function public.quote_order_checkout(
  uuid,text,uuid,numeric,jsonb,text
) to service_role;

grant execute on function public.create_order_checkout(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text
) to service_role;
