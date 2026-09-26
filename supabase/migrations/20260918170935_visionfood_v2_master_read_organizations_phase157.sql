drop policy if exists "visionfood master read organizations"
on public.organizations;

create policy "visionfood master read organizations"
on public.organizations
for select
to authenticated
using (
  master_id=(select auth.uid())
  and public.usuario_dono_org(
    id,
    (select auth.uid())
  )
);
