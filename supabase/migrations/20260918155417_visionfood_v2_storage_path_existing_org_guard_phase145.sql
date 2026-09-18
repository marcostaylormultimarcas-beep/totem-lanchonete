create or replace function public.visionfood_storage_org_path_allowed(_name text)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_folder text;
  v_org uuid;
  v_uid uuid;
begin
  v_folder := (storage.foldername(_name))[1];

  if v_folder is null
     or v_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  v_org := v_folder::uuid;
  v_uid := (select auth.uid());

  if v_uid is null then
    return false;
  end if;

  if not exists(
    select 1
    from public.organizations o
    where o.id=v_org
  ) then
    return false;
  end if;

  return public.usuario_dono_org(v_org,v_uid);
exception
  when invalid_text_representation then
    return false;
end
$$;

revoke all on function public.visionfood_storage_org_path_allowed(text) from public,anon;
grant execute on function public.visionfood_storage_org_path_allowed(text)
to authenticated,service_role;
