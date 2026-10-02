do $$
begin
  if to_regprocedure('public.eh_super_admin(uuid)') is null then
    raise exception 'public.eh_super_admin(uuid) not found';
  end if;

  if to_regprocedure('private.eh_super_admin(uuid)') is not null then
    raise exception 'private.eh_super_admin(uuid) already exists';
  end if;
end
$$;

alter function public.eh_super_admin(uuid)
set schema private;

revoke all on function private.eh_super_admin(uuid)
from public, anon;

grant execute on function private.eh_super_admin(uuid)
to authenticated, service_role;

do $$
declare
  r record;
  v_sql text;
begin
  for r in
    select
      p.oid,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f'
      and p.oid <> 'private.eh_super_admin(uuid)'::regprocedure
      and position(
        'public.eh_super_admin'
        in pg_get_functiondef(p.oid)
      ) > 0
  loop
    v_sql := replace(
      r.definition,
      'public.eh_super_admin',
      'private.eh_super_admin'
    );

    execute v_sql;
  end loop;
end
$$;

do $$
declare
  v_old_ref_count integer;
  v_old_policy_ref_count integer;
begin
  if to_regprocedure('public.eh_super_admin(uuid)') is not null then
    raise exception 'public.eh_super_admin surface still exists';
  end if;

  if to_regprocedure('private.eh_super_admin(uuid)') is null then
    raise exception 'private.eh_super_admin was not created by schema move';
  end if;

  select count(*)
    into v_old_ref_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f'
    and position(
      'public.eh_super_admin'
      in pg_get_functiondef(p.oid)
    ) > 0;

  if v_old_ref_count <> 0 then
    raise exception 'found % function definitions still referencing public.eh_super_admin',
      v_old_ref_count;
  end if;

  select count(*)
    into v_old_policy_ref_count
  from pg_policies
  where (
    coalesce(qual,'') ilike '%eh_super_admin%'
    or coalesce(with_check,'') ilike '%eh_super_admin%'
  )
  and (
    coalesce(qual,'') || ' ' || coalesce(with_check,'')
  ) not ilike '%private.eh_super_admin%';

  if v_old_policy_ref_count <> 0 then
    raise exception 'found % policies not resolving private.eh_super_admin',
      v_old_policy_ref_count;
  end if;
end
$$;

notify pgrst, 'reload schema';
