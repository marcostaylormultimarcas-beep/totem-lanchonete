drop policy if exists "visionfood public read senhas"
on public.senhas;

revoke select on table public.senhas from anon;
