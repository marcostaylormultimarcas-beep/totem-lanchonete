-- Phase 199: reassert the authoritative reset_senha_counter contract.
-- Historical Phase 41 exists in the official Supabase migration history but
-- is absent from GitHub, so fresh replay must not depend on it.

create table if not exists public.senhas_counters (
  organization_id uuid not null,
  prefixo text not null,
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, prefixo)
);

alter table public.senhas_counters enable row level security;
revoke all on table public.senhas_counters from public, anon, authenticated;
grant all on table public.senhas_counters to service_role;

do $phase199_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.senhas_counters'::regclass
      and conname='senhas_counters_last_number_check'
  ) then
    alter table public.senhas_counters
      add constraint senhas_counters_last_number_check
      check (last_number >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.senhas_counters'::regclass
      and conname='senhas_counters_prefixo_check'
  ) then
    alter table public.senhas_counters
      add constraint senhas_counters_prefixo_check
      check (prefixo ~ '^[A-Z0-9]{1,3}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.senhas_counters'::regclass
      and conname='senhas_counters_organization_id_fkey'
  ) then
    alter table public.senhas_counters
      add constraint senhas_counters_organization_id_fkey
      foreign key (organization_id)
      references public.organizations(id)
      on delete cascade;
  end if;
end
$phase199_constraints$;

create or replace function public.reset_senha_counter(
  _organization_id uuid,
  _prefixo text default 'A'::text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_prefix text := upper(trim(coalesce(_prefixo, 'A')));
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  if _organization_id is null
     or not private.usuario_dono_org(_organization_id, auth.uid()) then
    raise exception 'organization_access_denied';
  end if;

  if v_prefix !~ '^[A-Z0-9]{1,3}$' then
    raise exception 'invalid_prefix';
  end if;

  insert into public.senhas_counters as c (
    organization_id,
    prefixo,
    last_number,
    updated_at
  )
  values (
    _organization_id,
    v_prefix,
    0,
    now()
  )
  on conflict (organization_id, prefixo)
  do update
     set last_number = 0,
         updated_at = now();
end;
$function$;

alter function public.reset_senha_counter(uuid, text) owner to postgres;

revoke all on function public.reset_senha_counter(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function public.reset_senha_counter(uuid, text)
to authenticated, service_role;

do $phase199_verify$
declare
  v_oid oid;
  v_owner_oid oid;
  v_owner text;
  v_def text;
  v_acl aclitem[];
begin
  select p.oid, p.proowner, r.rolname, pg_get_functiondef(p.oid), p.proacl
    into v_oid, v_owner_oid, v_owner, v_def, v_acl
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  join pg_roles r on r.oid=p.proowner
  where n.nspname='public'
    and p.proname='reset_senha_counter'
    and pg_get_function_identity_arguments(p.oid) =
        '_organization_id uuid, _prefixo text';

  if v_oid is null then
    raise exception 'phase199_missing_reset_senha_counter';
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid=v_oid) then
    raise exception 'phase199_security_definer_required';
  end if;

  if v_owner <> 'postgres' then
    raise exception 'phase199_owner_mismatch';
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid=v_oid
      and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  ) then
    raise exception 'phase199_search_path_not_empty';
  end if;

  if exists (
    select 1
    from aclexplode(coalesce(v_acl, acldefault('f', v_owner_oid))) a
    where a.grantee=0
      and a.privilege_type='EXECUTE'
  ) then
    raise exception 'phase199_unexpected_public_execute';
  end if;

  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'phase199_unexpected_anon_execute';
  end if;

  if not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'phase199_expected_execute_missing';
  end if;

  if position('auth.uid() is null' in lower(v_def)) = 0
     or position('private.usuario_dono_org' in lower(v_def)) = 0
     or position('invalid_prefix' in lower(v_def)) = 0 then
    raise exception 'phase199_authorization_or_validation_contract_missing';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='senhas_counters'
      and c.relkind='r'
      and c.relrowsecurity
  ) then
    raise exception 'phase199_counter_table_rls_missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.senhas_counters'::regclass
      and conname='senhas_counters_last_number_check'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid='public.senhas_counters'::regclass
      and conname='senhas_counters_prefixo_check'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid='public.senhas_counters'::regclass
      and conname='senhas_counters_organization_id_fkey'
  ) then
    raise exception 'phase199_counter_table_constraints_missing';
  end if;
end
$phase199_verify$;
