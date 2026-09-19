drop policy if exists "visionfood read system settings" on public.system_settings;

create policy "visionfood authenticated read system settings"
on public.system_settings
for select
to authenticated
using (true);

revoke select on table public.system_settings from anon;
grant select on table public.system_settings to authenticated;
