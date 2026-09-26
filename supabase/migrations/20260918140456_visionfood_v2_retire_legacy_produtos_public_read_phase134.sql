drop policy if exists "public read produtos" on public.produtos;
revoke select on table public.produtos from anon;
