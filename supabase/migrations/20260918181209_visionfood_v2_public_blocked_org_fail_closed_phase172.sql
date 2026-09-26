create or replace function public.visionfood_public_organization(
  _org_id uuid default null::uuid,
  _slug text default null::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if _org_id is not null and nullif(btrim(coalesce(_slug,'')),'') is not null then
    raise exception 'provide organization id or slug, not both';
  end if;

  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'slug', o.slug,
    'logo_url', coalesce(o.logo_url,''),
    'endereco', coalesce(o.endereco,''),
    'cidade', coalesce(o.cidade,''),
    'estado', coalesce(o.estado,''),
    'cep', coalesce(o.cep,''),
    'telefone', coalesce(o.telefone,''),
    'whatsapp', coalesce(o.whatsapp,''),
    'instagram', coalesce(o.instagram,''),
    'latitude', o.latitude,
    'longitude', o.longitude,
    'categoria', coalesce(o.categoria,'outro'),
    'ativo', coalesce(o.ativo,true),
    'bloqueado', coalesce(o.bloqueado,false),
    'status', coalesce(o.status,'ativo'),
    'paused', (not coalesce(o.ativo,true) or coalesce(o.bloqueado,false))
  )
  into v_result
  from public.organizations o
  where
    (_org_id is not null and o.id=_org_id)
    or (
      _org_id is null
      and nullif(btrim(coalesce(_slug,'')),'') is not null
      and lower(btrim(o.slug))=lower(btrim(_slug))
    )
    or (
      _org_id is null
      and nullif(btrim(coalesce(_slug,'')),'') is null
      and coalesce(o.ativo,true)=true
      and coalesce(o.bloqueado,false)=false
    )
  order by o.created_at asc
  limit 1;

  return v_result;
end
$function$;

revoke all on function public.visionfood_public_organization(uuid,text) from public;
grant execute on function public.visionfood_public_organization(uuid,text) to anon,authenticated;

create or replace function public.visionfood_public_catalog(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when not exists (
      select 1
      from public.organizations o
      where o.id=_org
        and coalesce(o.ativo,true)=true
        and coalesce(o.bloqueado,false)=false
    ) then '[]'::jsonb
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',p.id,
          'name',p.name,
          'price',p.price,
          'category',p.category,
          'image',p.image,
          'removable_ingredients',coalesce(p.removable_ingredients,'[]'::jsonb),
          'extras',coalesce(p.extras,'[]'::jsonb),
          'is_combo',coalesce(p.is_combo,false),
          'ingredients',coalesce(p.ingredients,'[]'::jsonb),
          'description',coalesce(p.description,''),
          'organization_id',p.organization_id,
          'available',true,
          'codigo_barras',coalesce(p.codigo_barras,''),
          'sold_by_weight',coalesce(p.sold_by_weight,false),
          'prep_time_min',0
        )
        order by p.name,p.id
      )
      from public.products p
      where p.organization_id=_org
        and coalesce(p.available,true)=true
        and coalesce(p.ingredient_stock_blocked,false)=false
        and (coalesce(p.manage_stock,false)=false or coalesce(p.stock_quantity,0)>0)
    ),'[]'::jsonb)
  end
$function$;

revoke all on function public.visionfood_public_catalog(uuid) from public;
grant execute on function public.visionfood_public_catalog(uuid) to anon,authenticated;

create or replace function public.visionfood_public_storefront_config(_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if _org is null then
    raise exception 'invalid_organization';
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id=_org
      and coalesce(o.ativo,true)=true
      and coalesce(o.bloqueado,false)=false
  ) then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'organization_id',o.id,
    'store_name',coalesce(nullif(s.store_name,''),nullif(s.nome_loja,''),nullif(o.name,''),'VisionFood'),
    'whatsapp_number',coalesce(nullif(s.whatsapp_number,''),nullif(s.telefone,''),nullif(s.phone,''),nullif(o.whatsapp,''),nullif(o.telefone,''),''),
    'share_image',coalesce(nullif(s.cover_image,''),nullif(s.imagem_capa,''),nullif(s.logo_url,''),nullif(o.logo_url,''),''),
    'combo',coalesce(s.combo,'{}'::jsonb),
    'banners',coalesce(s.banners,'[]'::jsonb),
    'instagram_url',coalesce(nullif(s.instagram_url,''),nullif(o.instagram,''),''),
    'categories',coalesce(s.categories,'[]'::jsonb),
    'category_icons',coalesce(s.category_icons,'{}'::jsonb),
    'delivery_enabled',coalesce(s.delivery_enabled,true),
    'business_hours',s.business_hours,
    'emergency_closed',coalesce(s.emergency_closed,false),
    'closed_message',coalesce(nullif(s.closed_message,''),'Lanchonete fechada no momento'),
    'scheduling_enabled',coalesce(s.scheduling_enabled,true),
    'balanca_baud_rate',coalesce(s.balanca_baud_rate,9600),
    'delivery_tempo_base_min',coalesce(s.delivery_tempo_base_min,s.delivery_tempo_estimado,30),
    'delivery_mode',coalesce(s.delivery_mode,'bairros'),
    'updated_at',s.updated_at
  )
  into v_result
  from public.organizations o
  left join public.settings s on s.organization_id=o.id
  where o.id=_org
  limit 1;

  return coalesce(v_result,'{}'::jsonb);
end
$function$;

revoke all on function public.visionfood_public_storefront_config(uuid) from public;
grant execute on function public.visionfood_public_storefront_config(uuid) to anon,authenticated;

create or replace function public.visionfood_public_called_tickets(_org uuid,_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer;
  v_result jsonb;
begin
  if _org is null then
    raise exception 'invalid_organization';
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id=_org
      and coalesce(o.ativo,true)=true
      and coalesce(o.bloqueado,false)=false
  ) then
    return '[]'::jsonb;
  end if;

  v_limit := greatest(1,least(coalesce(_limit,5),20));

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',q.id,
        'numero',coalesce(q.numero,q.numero_senha,q.senha,''),
        'tipo',coalesce(q.tipo,'normal'),
        'called_at',coalesce(q.called_at,q.created_at)
      )
      order by coalesce(q.called_at,q.created_at) desc,q.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select *
    from public.senhas_chamadas s
    where s.organization_id=_org
    order by coalesce(s.called_at,s.created_at) desc,s.id desc
    limit v_limit
  ) q;

  return v_result;
end
$function$;

revoke all on function public.visionfood_public_called_tickets(uuid,integer) from public;
grant execute on function public.visionfood_public_called_tickets(uuid,integer) to anon,authenticated;
