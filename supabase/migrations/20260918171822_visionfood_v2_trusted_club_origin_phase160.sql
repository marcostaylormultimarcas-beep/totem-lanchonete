create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  org uuid;
begin
  begin
    org:=nullif(new.raw_user_meta_data->>'organization_id','')::uuid;
  exception
    when invalid_text_representation then
      org:=null;
  end;

  if org is not null
     and not exists(
       select 1
       from public.organizations
       where id=org
         and coalesce(ativo,true)=true
         and coalesce(bloqueado,false)=false
     )
  then
    org:=null;
  end if;

  insert into public.profiles(
    user_id,display_name,email,phone,organization_id,origem_assinatura_empresa_id
  )
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name',''),
    new.email,
    nullif(new.raw_user_meta_data->>'phone',''),
    org,
    null
  )
  on conflict(user_id) do update
  set
    display_name=excluded.display_name,
    email=excluded.email,
    phone=coalesce(excluded.phone,public.profiles.phone),
    organization_id=coalesce(public.profiles.organization_id,excluded.organization_id),
    origem_assinatura_empresa_id=public.profiles.origem_assinatura_empresa_id,
    updated_at=now();

  return new;
end
$$;

revoke execute on function public.handle_new_user()
from public,anon,authenticated,service_role;

create or replace function public.clube_vantagens_catalog(
  _fallback_org uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  u uuid:=(select auth.uid());
  origem uuid;
  cat text;
  nome text;
  items jsonb;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  select p.origem_assinatura_empresa_id
    into origem
  from public.profiles p
  where p.user_id=u
  limit 1;

  if origem is null then
    select v.organization_id
      into origem
    from public.vision_prime_assinaturas v
    where v.user_id=u
      and v.status='active'
    order by v.created_at asc,v.organization_id
    limit 1;
  end if;

  if origem is null then
    select o.organization_id
      into origem
    from public.orders o
    where o.user_id=u
      and o.organization_id is not null
      and o.status in ('delivered','completed')
    order by o.created_at asc,o.id
    limit 1;
  end if;

  if origem is null and _fallback_org is not null then
    return jsonb_build_object('ok',false,'reason','origin_not_linked');
  end if;

  if origem is null then
    return jsonb_build_object('ok',false,'reason','origin_not_found');
  end if;

  select coalesce(o.categoria,'outro'),o.name
    into cat,nome
  from public.organizations o
  where o.id=origem
    and coalesce(o.ativo,true)=true
    and coalesce(o.bloqueado,false)=false;

  if not found then
    return jsonb_build_object('ok',false,'reason','origin_not_found');
  end if;

  select coalesce(jsonb_agg(x order by x->>'partner_name'),'[]'::jsonb)
  into items
  from (
    select jsonb_build_object(
      'partner_id',o.id,
      'partner_name',o.name,
      'partner_slug',o.slug,
      'logo_url',o.logo_url,
      'categoria',coalesce(o.categoria,'outro'),
      'cupons',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',c.id,
            'codigo',c.codigo,
            'tipo',coalesce(c.tipo,c.tipo_desconto),
            'valor',c.valor
          )
          order by c.codigo
        )
        from public.cupons c
        where c.organization_id=o.id
          and coalesce(c.ativo,false)=true
          and coalesce(c.status,true)=true
          and (c.data_inicio is null or c.data_inicio<=now())
          and (c.data_fim is null or c.data_fim>=now())
          and (c.validade is null or c.validade>=now())
      ),'[]'::jsonb)
    ) x
    from public.parcerias p
    join public.organizations o
      on o.id=case when p.org_origem=origem then p.org_parceira else p.org_origem end
    where (p.org_origem=origem or p.org_parceira=origem)
      and p.status='active'
      and p.habilitada_origem
      and p.habilitada_parceira
      and coalesce(o.ativo,true)=true
      and coalesce(o.bloqueado,false)=false
      and coalesce(o.categoria,'outro')<>cat
  ) s
  where jsonb_array_length(x->'cupons')>0;

  return jsonb_build_object(
    'ok',true,
    'origem_id',origem,
    'origem_nome',nome,
    'origem_categoria',cat,
    'partners',items
  );
end
$$;

revoke all on function public.clube_vantagens_catalog(uuid)
from public,anon;

grant execute on function public.clube_vantagens_catalog(uuid)
to authenticated,service_role;
