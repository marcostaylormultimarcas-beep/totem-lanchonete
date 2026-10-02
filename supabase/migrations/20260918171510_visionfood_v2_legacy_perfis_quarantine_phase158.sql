drop policy if exists "user manage own perfil"
on public.perfis;

revoke select,insert,update,delete
on table public.perfis
from authenticated;
