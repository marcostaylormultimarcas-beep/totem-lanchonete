-- Phase 68: expose only the Prime fields needed by the storefront.
create or replace function public.vision_prime_public_config(_org uuid) returns table(ativo boolean,valor_mensalidade numeric,desconto_percentual numeric,frete_gratis_minimo numeric) language sql stable security definer set search_path='' as $$select coalesce(v.ativo,false),coalesce(v.valor_mensalidade,0),coalesce(v.desconto_percentual,0),coalesce(v.frete_gratis_minimo,0) from public.vision_prime_config v join public.organizations o on o.id=v.organization_id where v.organization_id=_org and coalesce(o.ativo,true)=true and coalesce(o.bloqueado,false)=false limit 1$$;
revoke all on function public.vision_prime_public_config(uuid) from public;
grant execute on function public.vision_prime_public_config(uuid) to anon,authenticated;
drop policy if exists "visionfood public read vision_prime_config" on public.vision_prime_config;
create policy "visionfood authenticated owner read vision_prime_config" on public.vision_prime_config for select to authenticated using(public.usuario_dono_org(organization_id,(select auth.uid())) or public.eh_super_admin((select auth.uid())));
revoke select on public.vision_prime_config from anon;
