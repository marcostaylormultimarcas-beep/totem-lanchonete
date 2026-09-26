create or replace function public.visionfood_public_storefront_config(_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  if _org is null then
    raise exception 'invalid_organization';
  end if;

  select jsonb_build_object(
    'organization_id', o.id,
    'store_name', coalesce(nullif(s.store_name,''),nullif(s.nome_loja,''),nullif(o.name,''),'VisionFood'),
    'whatsapp_number', coalesce(nullif(s.whatsapp_number,''),nullif(s.telefone,''),nullif(s.phone,''),nullif(o.whatsapp,''),nullif(o.telefone,''),''),
    'share_image', coalesce(nullif(s.cover_image,''),nullif(s.imagem_capa,''),nullif(s.logo_url,''),nullif(o.logo_url,''),''),
    'combo', coalesce(s.combo,'{}'::jsonb),
    'banners', coalesce(s.banners,'[]'::jsonb),
    'instagram_url', coalesce(nullif(s.instagram_url,''),nullif(o.instagram,''),''),
    'categories', coalesce(s.categories,'[]'::jsonb),
    'category_icons', coalesce(s.category_icons,'{}'::jsonb),
    'delivery_enabled', coalesce(s.delivery_enabled,true),
    'business_hours', s.business_hours,
    'emergency_closed', coalesce(s.emergency_closed,false),
    'closed_message', coalesce(nullif(s.closed_message,''),'Lanchonete fechada no momento'),
    'scheduling_enabled', coalesce(s.scheduling_enabled,true),
    'balanca_baud_rate', coalesce(s.balanca_baud_rate,9600),
    'delivery_tempo_base_min', coalesce(s.delivery_tempo_base_min,s.delivery_tempo_estimado,30),
    'delivery_mode', coalesce(s.delivery_mode,'bairros'),
    'updated_at', s.updated_at
  )
  into v_result
  from public.organizations o
  left join public.settings s on s.organization_id=o.id
  where o.id=_org
  limit 1;

  if not found then
    raise exception 'organization_not_found';
  end if;

  return v_result;
end
$$;

revoke all on function public.visionfood_public_storefront_config(uuid) from public;
grant execute on function public.visionfood_public_storefront_config(uuid)
to anon,authenticated,service_role;
