
alter table public.settings
  add column if not exists delivery_origin_cep text not null default '',
  add column if not exists delivery_origin_street text not null default '',
  add column if not exists delivery_origin_number text not null default '',
  add column if not exists delivery_origin_complement text not null default '',
  add column if not exists delivery_origin_neighborhood text not null default '',
  add column if not exists delivery_origin_city text not null default '',
  add column if not exists delivery_origin_state text not null default '',
  add column if not exists delivery_origin_lat numeric,
  add column if not exists delivery_origin_lng numeric,
  add column if not exists delivery_origin_confirmed_at timestamptz;

update public.settings
set
  delivery_origin_cep = case
    when btrim(coalesce(delivery_origin_cep,''))='' then regexp_replace(coalesce(cep_loja,''),'[^0-9]','','g')
    else delivery_origin_cep
  end,
  delivery_origin_lat = coalesce(delivery_origin_lat,cep_lat),
  delivery_origin_lng = coalesce(delivery_origin_lng,cep_lng,cep_lon)
where
  btrim(coalesce(delivery_origin_cep,''))=''
  or delivery_origin_lat is null
  or delivery_origin_lng is null;

alter table public.settings
  drop constraint if exists settings_delivery_origin_lat_check,
  drop constraint if exists settings_delivery_origin_lng_check,
  drop constraint if exists settings_delivery_origin_state_check;

alter table public.settings
  add constraint settings_delivery_origin_lat_check
    check (delivery_origin_lat is null or (delivery_origin_lat between -90 and 90)),
  add constraint settings_delivery_origin_lng_check
    check (delivery_origin_lng is null or (delivery_origin_lng between -180 and 180)),
  add constraint settings_delivery_origin_state_check
    check (char_length(delivery_origin_state) <= 2);

create or replace function public.validar_cep_entrega(
  _org uuid, _cep text, _lat numeric default null, _lng numeric default null
)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $function$
declare
  v_org public.organizations%rowtype;
  v_settings public.settings%rowtype;
  v_cep public.cep_atendidos%rowtype;
  v_mode text;
  v_lat numeric;
  v_lng numeric;
  v_dist numeric;
  v_taxa numeric;
  v_tempo numeric;
begin
  if _org is null then
    return jsonb_build_object('ok',false,'motivo','sem_configuracao');
  end if;

  select *
  into v_org
  from public.organizations
  where id=_org
  limit 1;

  if not found
     or coalesce(v_org.ativo,false) is not true
     or coalesce(v_org.bloqueado,false) is true
     or coalesce(v_org.status,'ativo')<>'ativo'
     or coalesce(v_org.status_assinatura,'ativo')<>'ativo' then
    return jsonb_build_object('ok',false,'motivo','loja_indisponivel');
  end if;

  select *
  into v_settings
  from public.settings
  where organization_id=_org
  limit 1;

  if not found or coalesce(v_settings.delivery_enabled,true) is not true then
    return jsonb_build_object('ok',false,'motivo','sem_configuracao');
  end if;

  v_mode:=coalesce(v_settings.delivery_mode,'bairros');

  if v_mode='lista_ceps' then
    if coalesce(_cep,'') !~ '^[0-9]{8}$' then
      return jsonb_build_object('ok',false,'motivo','cep_invalido');
    end if;

    select *
    into v_cep
    from public.cep_atendidos
    where organization_id=_org
      and regexp_replace(cep,'[^0-9]','','g')=_cep
    limit 1;

    if not found then
      return jsonb_build_object('ok',false,'motivo','fora_da_area');
    end if;

    return jsonb_build_object(
      'ok',true,
      'taxa',greatest(coalesce(v_cep.taxa,0),0),
      'tempo_min',coalesce(v_cep.tempo_min,v_cep.tempo_estimado,30),
      'distancia_km',null
    );
  elsif v_mode='raio_km' then
    v_lat:=coalesce(v_settings.delivery_origin_lat,v_settings.cep_lat);
    v_lng:=coalesce(v_settings.delivery_origin_lng,v_settings.cep_lng,v_settings.cep_lon);

    if v_lat is null or v_lng is null or _lat is null or _lng is null then
      return jsonb_build_object('ok',false,'motivo','sem_coordenadas');
    end if;

    if _lat < -90 or _lat > 90 or _lng < -180 or _lng > 180 then
      return jsonb_build_object('ok',false,'motivo','sem_coordenadas');
    end if;

    v_dist:=6371*2*asin(sqrt(
      power(sin(radians((_lat-v_lat)/2)),2)
      +cos(radians(v_lat))*cos(radians(_lat))
      *power(sin(radians((_lng-v_lng)/2)),2)
    ));

    if v_dist > greatest(coalesce(v_settings.delivery_raio_km,0),0) then
      return jsonb_build_object(
        'ok',false,
        'motivo','fora_do_raio',
        'distancia_km',round(v_dist,2)
      );
    end if;

    v_taxa:=greatest(coalesce(v_settings.delivery_taxa_base,0),0)
      +greatest(coalesce(v_settings.delivery_taxa_por_km,0),0)*v_dist;
    v_tempo:=greatest(coalesce(v_settings.delivery_tempo_base_min,0),0)
      +greatest(coalesce(v_settings.delivery_tempo_por_km_min,0),0)*v_dist;

    return jsonb_build_object(
      'ok',true,
      'taxa',round(v_taxa,2),
      'tempo_min',ceil(v_tempo),
      'distancia_km',round(v_dist,2)
    );
  end if;

  return jsonb_build_object('ok',false,'motivo','modo_bairros');
end
$function$;
