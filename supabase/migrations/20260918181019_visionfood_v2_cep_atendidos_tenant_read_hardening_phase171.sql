drop policy if exists "visionfood public read cep_atendidos" on public.cep_atendidos;

drop policy if exists "visionfood owner read cep_atendidos" on public.cep_atendidos;
create policy "visionfood owner read cep_atendidos"
on public.cep_atendidos
for select
to authenticated
using (
  public.usuario_dono_org(organization_id, (select auth.uid()))
  or public.eh_super_admin((select auth.uid()))
);

revoke select on table public.cep_atendidos from anon;
grant select on table public.cep_atendidos to authenticated;
