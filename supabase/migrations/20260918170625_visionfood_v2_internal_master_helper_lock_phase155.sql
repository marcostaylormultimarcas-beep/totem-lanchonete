revoke execute on function public.eh_master_admin(uuid)
from public,anon,authenticated;

grant execute on function public.eh_master_admin(uuid)
to service_role;
