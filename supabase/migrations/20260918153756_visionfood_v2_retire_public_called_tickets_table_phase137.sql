drop policy if exists "visionfood public read senhas_chamadas"
on public.senhas_chamadas;

revoke select on table public.senhas_chamadas from anon;
