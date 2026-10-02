
revoke execute on function public.visionfood_set_delivery_code()
  from public,anon,authenticated;

grant execute on function public.visionfood_set_delivery_code()
  to service_role;
