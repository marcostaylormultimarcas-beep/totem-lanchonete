drop policy if exists "visionfood public read active config_fidelidade" on public.config_fidelidade;
create policy "visionfood anon read active config_fidelidade"
on public.config_fidelidade
for select
to anon
using (
  public.visionfood_public_organization(organization_id,null)
    @> '{"paused":false,"status":"ativo"}'::jsonb
  and coalesce(ativo,false)=true
  and (data_inicio is null or data_inicio<=now())
  and (data_fim is null or data_fim>=now())
);

drop policy if exists "visionfood public read loja_temas" on public.loja_temas;
create policy "visionfood anon read available loja_temas"
on public.loja_temas
for select
to anon
using (
  public.visionfood_public_organization(organization_id,null)
    @> '{"paused":false,"status":"ativo"}'::jsonb
);

drop policy if exists "visionfood owner read loja_temas" on public.loja_temas;
create policy "visionfood owner read loja_temas"
on public.loja_temas
for select
to authenticated
using (
  public.usuario_dono_org(organization_id,(select auth.uid()))
  or public.eh_super_admin((select auth.uid()))
);

drop policy if exists "reviews_public_safe_read" on public.product_reviews;
drop policy if exists "reviews anon available safe read" on public.product_reviews;
drop policy if exists "reviews authenticated available safe read" on public.product_reviews;

create policy "reviews anon available safe read"
on public.product_reviews
for select
to anon
using (
  public.visionfood_public_organization(organization_id,null)
    @> '{"paused":false,"status":"ativo"}'::jsonb
);

create policy "reviews authenticated available safe read"
on public.product_reviews
for select
to authenticated
using (
  public.visionfood_public_organization(organization_id,null)
    @> '{"paused":false,"status":"ativo"}'::jsonb
);

drop policy if exists "visionfood public read active taxas_entrega" on public.taxas_entrega;
create policy "visionfood anon read active taxas_entrega"
on public.taxas_entrega
for select
to anon
using (
  public.visionfood_public_organization(organization_id,null)
    @> '{"paused":false,"status":"ativo"}'::jsonb
  and coalesce(ativo,true)=true
);

drop policy if exists "visionfood owner read taxas_entrega" on public.taxas_entrega;
create policy "visionfood owner read taxas_entrega"
on public.taxas_entrega
for select
to authenticated
using (
  public.usuario_dono_org(organization_id,(select auth.uid()))
  or public.eh_super_admin((select auth.uid()))
);
