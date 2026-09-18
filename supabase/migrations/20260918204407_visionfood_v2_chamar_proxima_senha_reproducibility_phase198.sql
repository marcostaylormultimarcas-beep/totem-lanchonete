-- Phase 198: reassert the authoritative chamar_proxima_senha contract.
-- This also makes fresh migration replay independent from historical Phase 41
-- drift while preserving the current production table shape.

create table if not exists public.senhas_counters (
  organization_id uuid not null,
  prefixo text not null,
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, prefixo)
);

alter table public.senhas_counters enable row level security;
revoke all on table public.senhas_counters from public, anon, authenticated;

create or replace function public.chamar_proxima_senha(
  _organization_id uuid,
  _prefixo text default 'A'::text,
  _tipo text default 'normal'::text
)
returns table(
  id uuid,
  numero text,
  tipo text,
  called_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_prefix text := upper(trim(coalesce(_prefixo, 'A')));
  v_next integer;
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

  if _tipo is null or _tipo not in ('normal', 'preferencial') then
    raise exception 'invalid_ticket_type';
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
    1,
    now()
  )
  on conflict (organization_id, prefixo)
  do update
     set last_number = c.last_number + 1,
         updated_at = now()
  returning last_number into v_next;

  return query
  insert into public.senhas_chamadas (
    organization_id,
    prefixo,
    numero,
    numero_senha,
    senha,
    tipo,
    prioritaria,
    called_by,
    called_at
  )
  values (
    _organization_id,
    v_prefix,
    v_prefix || lpad(v_next::text, 3, '0'),
    v_prefix || lpad(v_next::text, 3, '0'),
    v_prefix || lpad(v_next::text, 3, '0'),
    _tipo,
    _tipo = 'preferencial',
    auth.uid()::text,
    now()
  )
  returning
    senhas_chamadas.id,
    senhas_chamadas.numero,
    senhas_chamadas.tipo,
    senhas_chamadas.called_at;
end;
$function$;

alter function public.chamar_proxima_senha(uuid, text, text) owner to postgres;

revoke all on function public.chamar_proxima_senha(uuid, text, text) from public, anon;
grant execute on function public.chamar_proxima_senha(uuid, text, text) to authenticated, service_role;

do $$
declare
  v_oid oid;
  v_owner text;
  v_def text;
begin
  select p.oid, r.rolname, pg_get_functiondef(p.oid)
    into v_oid, v_owner, v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public'
    and p.proname = 'chamar_proxima_senha'
    and pg_get_function_identity_arguments(p.oid) =
        '_organization_id uuid, _prefixo text, _tipo text';

  if v_oid is null then
    raise exception 'phase198_missing_chamar_proxima_senha';
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
    raise exception 'phase198_security_definer_required';
  end if;

  if v_owner <> 'postgres' then
    raise exception 'phase198_owner_mismatch';
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = v_oid
      and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  ) then
    raise exception 'phase198_search_path_not_empty';
  end if;

  if has_function_privilege('public', v_oid, 'EXECUTE')
     or has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'phase198_unexpected_public_execute';
  end if;

  if not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'phase198_expected_execute_missing';
  end if;

  if position('if _tipo is null or _tipo not in' in lower(v_def)) = 0 then
    raise exception 'phase198_ticket_type_null_guard_missing';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'senhas_counters'
      and c.relkind = 'r'
      and c.relrowsecurity
  ) then
    raise exception 'phase198_counter_table_contract_missing';
  end if;
end
$$;
