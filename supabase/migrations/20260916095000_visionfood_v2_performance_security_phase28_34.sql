-- VisionFood V2: repository sync for database hardening phases 28-34.
-- These statements mirror changes already applied to Supabase project udhcnpauymevkylldkir.

-- Phase 28: cache auth.uid() once per statement in remaining RLS policies.
do $$
declare r record; q text; c text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') ~ 'auth\.uid\(\)' or coalesce(with_check,'') ~ 'auth\.uid\(\)')
  loop
    q := case when r.qual is null then null else replace(r.qual,'auth.uid()','(select auth.uid())') end;
    c := case when r.with_check is null then null else replace(r.with_check,'auth.uid()','(select auth.uid())') end;
    execute format('alter policy %I on %I.%I%s%s', r.policyname, r.schemaname, r.tablename,
      case when q is not null then ' using ('||q||')' else '' end,
      case when c is not null then ' with check ('||c||')' else '' end);
  end loop;
end $$;

-- Phase 29: cover all remaining foreign keys used by the commercial schema.
create index if not exists bairros_atendidos_organization_id_idx on public.bairros_atendidos(organization_id);
create index if not exists cancelamentos_pedido_organization_id_idx on public.cancelamentos_pedido(organization_id);
create index if not exists cancelamentos_pedido_pedido_id_idx on public.cancelamentos_pedido(pedido_id);
create index if not exists categorias_organization_id_idx on public.categorias(organization_id);
create index if not exists ceps_atendidos_organization_id_idx on public.ceps_atendidos(organization_id);
create index if not exists ingredientes_organization_id_idx on public.ingredientes(organization_id);
create index if not exists papeis_usuario_organization_id_idx on public.papeis_usuario(organization_id);
create index if not exists pedidos_entregador_id_idx on public.pedidos(entregador_id);
create index if not exists pedidos_carimbados_organization_id_idx on public.pedidos_carimbados(organization_id);
create index if not exists perfis_organization_id_idx on public.perfis(organization_id);
create index if not exists plan_features_feature_id_idx on public.plan_features(feature_id);
create index if not exists plano_recursos_plano_id_idx on public.plano_recursos(plano_id);
create index if not exists progresso_fidelidade_ultimo_pedido_id_idx on public.progresso_fidelidade(ultimo_pedido_id);
create index if not exists resgates_fidelidade_organization_id_idx on public.resgates_fidelidade(organization_id);

-- Phase 30: remove exact duplicate indexes; keep canonical *_organization_id_idx names.
drop index if exists public.idx_orders_org;
drop index if exists public.idx_products_org;

-- Phase 31: remove policies that were exact permission duplicates.
drop policy if exists "visionfood owner read assinatura" on public.assinaturas_loja;
drop policy if exists "Permitir leitura publica em categorias" on public.categorias;

-- Phase 32: public storefront reads belong to anon; authenticated access is handled by owner/admin policies.
alter policy "public read bairros_atendidos" on public.bairros_atendidos to anon;
alter policy "public read categorias" on public.categorias to anon;
alter policy "public read ceps_atendidos" on public.ceps_atendidos to anon;
alter policy "public read config_fidelidade" on public.config_fidelidade to anon;
alter policy "public read cupons ativos" on public.cupons to anon;
alter policy "public read organizations" on public.organizations to anon;
alter policy "public read produtos" on public.produtos to anon;
alter policy "public read recursos" on public.recursos to anon;
alter policy "visionfood public read senhas" on public.senhas to anon;
alter policy "visionfood public read senhas_chamadas" on public.senhas_chamadas to anon;
alter policy "public read temas_loja" on public.temas_loja to anon;

-- Phase 33: consolidate the remaining overlapping permissive policies without changing effective access.
drop policy if exists "visionfood customer read own orders" on public.orders;
drop policy if exists "visionfood owner read orders" on public.orders;
create policy "visionfood authenticated read orders" on public.orders for select to authenticated
using ((user_id = (select auth.uid())) or ((organization_id is not null) and public.usuario_dono_org(organization_id, (select auth.uid()))));

drop policy if exists "user read own papeis" on public.papeis_usuario;
create policy "user read own papeis" on public.papeis_usuario for select to authenticated
using ((user_id = (select auth.uid())) or public.eh_super_admin((select auth.uid())));
drop policy if exists "super manage papeis" on public.papeis_usuario;
create policy "super insert papeis" on public.papeis_usuario for insert to authenticated
with check (public.eh_super_admin((select auth.uid())));
create policy "super update papeis" on public.papeis_usuario for update to authenticated
using (public.eh_super_admin((select auth.uid()))) with check (public.eh_super_admin((select auth.uid())));
create policy "super delete papeis" on public.papeis_usuario for delete to authenticated
using (public.eh_super_admin((select auth.uid())));

drop policy if exists "owner manage pedidos" on public.pedidos;
create policy "owner update pedidos" on public.pedidos for update to authenticated
using (public.usuario_dono_org(organization_id, (select auth.uid())) or public.eh_super_admin((select auth.uid())))
with check (public.usuario_dono_org(organization_id, (select auth.uid())) or public.eh_super_admin((select auth.uid())));
create policy "owner delete pedidos" on public.pedidos for delete to authenticated
using (public.usuario_dono_org(organization_id, (select auth.uid())) or public.eh_super_admin((select auth.uid())));
drop policy if exists "visionfood customer read own pedidos" on public.pedidos;
create policy "visionfood authenticated read pedidos" on public.pedidos for select to authenticated
using ((user_id = (select auth.uid())) or public.usuario_dono_org(organization_id, (select auth.uid())) or public.eh_super_admin((select auth.uid())));

-- Phase 34: quarantine legacy connectivity-test table; no records are deleted.
drop policy if exists "public all teste_conexao" on public.teste_conexao;
revoke all privileges on table public.teste_conexao from anon, authenticated;
grant all privileges on table public.teste_conexao to service_role;
