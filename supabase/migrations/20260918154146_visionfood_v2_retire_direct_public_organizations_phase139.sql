drop policy if exists "public read organizations"
on public.organizations;

revoke select on table public.organizations from anon;
