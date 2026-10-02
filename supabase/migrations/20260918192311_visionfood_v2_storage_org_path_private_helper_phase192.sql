alter function public.visionfood_storage_org_path_allowed(text) set schema private;

revoke all on function private.visionfood_storage_org_path_allowed(text)
from public, anon, service_role;

grant execute on function private.visionfood_storage_org_path_allowed(text)
to authenticated;

do $$
declare
  v_sql text;
begin
  select pg_get_functiondef(p.oid)
    into v_sql
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and p.proname='visionfood_storage_quota_reserve'
    and pg_get_function_identity_arguments(p.oid)='_bucket_id text, _name text, _metadata jsonb';

  if v_sql is null then
    raise exception 'visionfood_storage_quota_reserve not found';
  end if;

  if position('public.visionfood_storage_org_path_allowed' in v_sql)=0 then
    raise exception 'expected public helper reference not found';
  end if;

  v_sql := replace(
    v_sql,
    'public.visionfood_storage_org_path_allowed',
    'private.visionfood_storage_org_path_allowed'
  );

  execute v_sql;
end
$$;

notify pgrst, 'reload schema';
