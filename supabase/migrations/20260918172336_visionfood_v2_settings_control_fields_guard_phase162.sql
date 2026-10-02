create or replace function public.visionfood_guard_settings_control_fields()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return new; end if;
  if public.eh_super_admin(v_uid) then return new; end if;

  if tg_op='INSERT' then
    if new.organization_id is null
       or not public.usuario_dono_org(new.organization_id,v_uid)
    then
      raise exception 'settings_organization_forbidden';
    end if;
    if coalesce(new.taxa_vision_percent,0) <> 0 then
      raise exception 'settings_control_field_forbidden';
    end if;
    return new;
  end if;

  if tg_op='UPDATE' then
    if old.organization_id is null
       or not public.usuario_dono_org(old.organization_id,v_uid)
    then
      raise exception 'settings_organization_forbidden';
    end if;
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.created_at is distinct from old.created_at
       or new.taxa_vision_percent is distinct from old.taxa_vision_percent
    then
      raise exception 'settings_control_field_forbidden';
    end if;
    return new;
  end if;

  return new;
end
$$;

revoke execute on function public.visionfood_guard_settings_control_fields()
from public,anon,authenticated,service_role;

drop trigger if exists trg_visionfood_guard_settings_control_fields
on public.settings;

create trigger trg_visionfood_guard_settings_control_fields
before insert or update
on public.settings
for each row
execute function public.visionfood_guard_settings_control_fields();
