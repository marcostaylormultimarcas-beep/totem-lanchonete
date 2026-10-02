do $$
declare
  r record;
begin
  for r in
    with candidates as (
      select
        c.oid,
        c.relname,
        unnest(array['INSERT','UPDATE','DELETE']) as privilege_type
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public'
        and c.relkind in ('r','p')
        and c.relrowsecurity
    ),
    granted as (
      select *
      from candidates
      where has_table_privilege(
        'authenticated',
        oid,
        privilege_type
      )
    )
    select g.relname,g.privilege_type
    from granted g
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname='public'
        and p.tablename=g.relname
        and (
          p.cmd=g.privilege_type
          or p.cmd='ALL'
        )
        and (
          'authenticated'=any(p.roles)
          or 'public'=any(p.roles)
        )
    )
  loop
    execute format(
      'revoke %s on table public.%I from authenticated',
      r.privilege_type,
      r.relname
    );
  end loop;
end
$$;
