create unique index if not exists ux_settings_organization_id
on public.settings(organization_id)
where organization_id is not null;

drop policy if exists "settings_tenant_delete"
on public.settings;

drop policy if exists "settings_super_delete"
on public.settings;

create policy "settings_super_delete"
on public.settings
for delete
to authenticated
using (
  public.eh_super_admin((select auth.uid()))
);
