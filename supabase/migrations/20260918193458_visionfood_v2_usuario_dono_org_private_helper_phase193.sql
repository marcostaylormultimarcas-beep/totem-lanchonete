do $$
begin
  if to_regprocedure('public.usuario_dono_org(uuid,uuid)') is null then
    raise exception 'public.usuario_dono_org(uuid,uuid) not found';
  end if;

  if to_regprocedure('private.usuario_dono_org(uuid,uuid)') is not null then
    raise exception 'private.usuario_dono_org(uuid,uuid) already exists';
  end if;
end
$$;

alter function public.usuario_dono_org(uuid,uuid)
set schema private;

revoke all on function private.usuario_dono_org(uuid,uuid)
from public, anon;

grant execute on function private.usuario_dono_org(uuid,uuid)
to authenticated, service_role;

do $$
declare
  r record;
  v_sql text;
begin
  for r in
    select
      p.oid,
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid) as identity_args,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f'
      and p.oid <> 'private.usuario_dono_org(uuid,uuid)'::regprocedure
      and position(
        'public.usuario_dono_org'
        in pg_get_functiondef(p.oid)
      ) > 0
  loop
    v_sql := replace(
      r.definition,
      'public.usuario_dono_org',
      'private.usuario_dono_org'
    );

    execute v_sql;
  end loop;
end
$$;

do $$
declare
  v_old_ref_count integer;
begin
  if to_regprocedure('public.usuario_dono_org(uuid,uuid)') is not null then
    raise exception 'public.usuario_dono_org surface still exists';
  end if;

  if to_regprocedure('private.usuario_dono_org(uuid,uuid)') is null then
    raise exception 'private.usuario_dono_org was not created by schema move';
  end if;

  select count(*)
    into v_old_ref_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f'
    and position(
      'public.usuario_dono_org'
      in pg_get_functiondef(p.oid)
    ) > 0;

  if v_old_ref_count <> 0 then
    raise exception 'found % function definitions still referencing public.usuario_dono_org',
      v_old_ref_count;
  end if;
end
$$;

notify pgrst, 'reload schema';
