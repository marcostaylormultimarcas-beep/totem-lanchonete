create or replace function public.visionfood_link_google_profile(_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_display_name text;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.identities i
    where i.user_id = v_uid
      and i.provider = 'google'
  ) then
    raise exception 'google_identity_required' using errcode = '42501';
  end if;

  if _organization_id is null
     or not exists (
       select 1
       from public.organizations o
       where o.id = _organization_id
         and coalesce(o.ativo, true) = true
         and coalesce(o.bloqueado, false) = false
     )
  then
    raise exception 'organization_unavailable' using errcode = '22023';
  end if;

  select coalesce(
           nullif(btrim(u.raw_user_meta_data->>'display_name'), ''),
           nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data->>'name'), '')
         )
    into v_display_name
  from auth.users u
  where u.id = v_uid;

  update public.profiles p
     set organization_id = coalesce(p.organization_id, _organization_id),
         display_name = case
           when nullif(btrim(coalesce(p.display_name, '')), '') is null
             then coalesce(v_display_name, p.display_name)
           else p.display_name
         end,
         updated_at = now()
   where p.user_id = v_uid;

  if not found then
    raise exception 'profile_not_found';
  end if;

  return true;
end
$function$;

revoke all on function public.visionfood_link_google_profile(uuid) from public;
revoke all on function public.visionfood_link_google_profile(uuid) from anon;
grant execute on function public.visionfood_link_google_profile(uuid) to authenticated;
