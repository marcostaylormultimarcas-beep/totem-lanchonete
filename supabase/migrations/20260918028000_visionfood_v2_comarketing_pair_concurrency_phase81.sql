-- Phase 81: concurrency-safe unordered partnership uniqueness.
create unique index if not exists parcerias_unordered_pair_unique
on public.parcerias ((least(org_origem::text,org_parceira::text)),(greatest(org_origem::text,org_parceira::text)));

create or replace function public.parceria_request(_org_origem uuid,_org_parceira uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); i uuid; origem record; parceira record; existing record;
begin
 if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 if not public.usuario_dono_org(_org_origem,u) and not public.eh_super_admin(u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if _org_origem=_org_parceira then return jsonb_build_object('ok',false,'reason','invalid_partner'); end if;
 select id,cidade,coalesce(categoria,'outro') categoria into origem from public.organizations where id=_org_origem and coalesce(ativo,true)=true;
 select id,cidade,coalesce(categoria,'outro') categoria into parceira from public.organizations where id=_org_parceira and coalesce(ativo,true)=true;
 if origem.id is null or parceira.id is null then return jsonb_build_object('ok',false,'reason','invalid_partner'); end if;
 if coalesce(lower(trim(origem.cidade)),'')='' or lower(trim(origem.cidade))<>lower(trim(parceira.cidade)) then return jsonb_build_object('ok',false,'reason','different_city'); end if;
 if origem.categoria<>'outro' and parceira.categoria=origem.categoria then return jsonb_build_object('ok',false,'reason','same_category'); end if;
 select id,status into existing from public.parcerias where (org_origem=_org_origem and org_parceira=_org_parceira) or (org_origem=_org_parceira and org_parceira=_org_origem) order by created_at limit 1;
 if existing.id is not null then
  if existing.status in('pending','active') then return jsonb_build_object('ok',false,'reason','partnership_exists','id',existing.id); end if;
  begin update public.parcerias set org_origem=_org_origem,org_parceira=_org_parceira,status='pending',updated_at=now() where id=existing.id returning id into i;
  exception when unique_violation then select id into i from public.parcerias where (org_origem=_org_origem and org_parceira=_org_parceira) or (org_origem=_org_parceira and org_parceira=_org_origem) limit 1; return jsonb_build_object('ok',false,'reason','partnership_exists','id',i); end;
 else
  begin insert into public.parcerias(org_origem,org_parceira,status) values(_org_origem,_org_parceira,'pending') returning id into i;
  exception when unique_violation then select id into i from public.parcerias where (org_origem=_org_origem and org_parceira=_org_parceira) or (org_origem=_org_parceira and org_parceira=_org_origem) limit 1; return jsonb_build_object('ok',false,'reason','partnership_exists','id',i); end;
 end if;
 return jsonb_build_object('ok',true,'id',i);
end$$;
revoke all on function public.parceria_request(uuid,uuid) from public,anon;
grant execute on function public.parceria_request(uuid,uuid) to authenticated;
