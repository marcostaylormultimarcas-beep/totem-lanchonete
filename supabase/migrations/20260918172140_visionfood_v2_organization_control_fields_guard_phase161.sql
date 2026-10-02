create or replace function public.visionfood_guard_organization_control_fields()
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
    if new.owner_id is distinct from v_uid then
      raise exception 'organization_owner_forbidden';
    end if;
    if new.master_id is not null
       or new.plan_id is not null
       or new.ativo is distinct from true
       or new.bloqueado is distinct from false
       or new.vencimento_at is not null
       or coalesce(new.status,'ativo') <> 'ativo'
       or coalesce(new.status_assinatura,'ativo') <> 'ativo'
       or new.mp_subscription_id is not null
       or new.mp_next_charge_at is not null
       or new.mp_subscription_amount is not null
    then
      raise exception 'organization_control_field_forbidden';
    end if;
    return new;
  end if;

  if tg_op='UPDATE' then
    if old.owner_id is distinct from v_uid then
      raise exception 'organization_owner_forbidden';
    end if;
    if new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id
       or new.master_id is distinct from old.master_id
       or new.plan_id is distinct from old.plan_id
       or new.ativo is distinct from old.ativo
       or new.bloqueado is distinct from old.bloqueado
       or new.vencimento_at is distinct from old.vencimento_at
       or new.status is distinct from old.status
       or new.status_assinatura is distinct from old.status_assinatura
       or new.created_at is distinct from old.created_at
       or new.mp_subscription_id is distinct from old.mp_subscription_id
       or new.mp_next_charge_at is distinct from old.mp_next_charge_at
       or new.mp_subscription_amount is distinct from old.mp_subscription_amount
    then
      raise exception 'organization_control_field_forbidden';
    end if;
    return new;
  end if;

  return new;
end
$$;

revoke execute on function public.visionfood_guard_organization_control_fields()
from public,anon,authenticated,service_role;

drop trigger if exists trg_visionfood_guard_organization_control_fields
on public.organizations;

create trigger trg_visionfood_guard_organization_control_fields
before insert or update
on public.organizations
for each row
execute function public.visionfood_guard_organization_control_fields();

drop policy if exists "owner manage organizations"
on public.organizations;

drop policy if exists "visionfood owner read organizations"
on public.organizations;
create policy "visionfood owner read organizations"
on public.organizations
for select
to authenticated
using (
  owner_id=(select auth.uid())
  or public.eh_super_admin((select auth.uid()))
);

drop policy if exists "visionfood owner insert organizations"
on public.organizations;
create policy "visionfood owner insert organizations"
on public.organizations
for insert
to authenticated
with check (
  owner_id=(select auth.uid())
  or public.eh_super_admin((select auth.uid()))
);

drop policy if exists "visionfood owner update organizations"
on public.organizations;
create policy "visionfood owner update organizations"
on public.organizations
for update
to authenticated
using (
  owner_id=(select auth.uid())
  or public.eh_super_admin((select auth.uid()))
)
with check (
  owner_id=(select auth.uid())
  or public.eh_super_admin((select auth.uid()))
);

drop policy if exists "visionfood super delete organizations"
on public.organizations;
create policy "visionfood super delete organizations"
on public.organizations
for delete
to authenticated
using (
  public.eh_super_admin((select auth.uid()))
);
