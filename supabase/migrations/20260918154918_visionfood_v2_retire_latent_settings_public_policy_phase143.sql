drop policy if exists "settings_public_read"
on public.settings;

revoke select on table public.settings from anon;
