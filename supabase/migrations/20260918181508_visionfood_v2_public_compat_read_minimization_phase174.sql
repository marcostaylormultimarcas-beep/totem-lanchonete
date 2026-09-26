drop policy if exists "visionfood public read taxas_entrega" on public.taxas_entrega;
create policy "visionfood public read active taxas_entrega"
on public.taxas_entrega
for select
to anon,authenticated
using (coalesce(ativo,true)=true);

drop policy if exists "public read config_fidelidade" on public.config_fidelidade;
create policy "visionfood public read active config_fidelidade"
on public.config_fidelidade
for select
to anon,authenticated
using (
  coalesce(ativo,false)=true
  and (data_inicio is null or data_inicio<=now())
  and (data_fim is null or data_fim>=now())
);

grant select on table public.taxas_entrega to anon,authenticated;
grant select on table public.config_fidelidade to anon,authenticated;
