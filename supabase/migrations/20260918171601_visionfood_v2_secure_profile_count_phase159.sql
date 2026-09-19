create or replace function public.visionfood_profile_count(_org uuid)
returns bigint
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count bigint;
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  if _org is null
     or not public.usuario_dono_org(_org,v_uid)
  then
    raise exception 'forbidden';
  end if;

  select count(*)::bigint
    into v_count
  from public.profiles p
  where p.organization_id=_org;

  return coalesce(v_count,0);
end
$$;

revoke all on function public.visionfood_profile_count(uuid)
from public,anon;

grant execute on function public.visionfood_profile_count(uuid)
to authenticated,service_role;
