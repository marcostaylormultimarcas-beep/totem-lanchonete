drop policy if exists "visionfood authenticated read products"
on public.products;

create policy "visionfood authenticated read products"
on public.products
for select
to authenticated
using (
  organization_id is not null
  and public.usuario_dono_org(
    organization_id,
    (select auth.uid())
  )
);
