create or replace function public.validar_cep_entrega(
  _org uuid,
  _cep text,
  _lat numeric default null::numeric,
  _lng numeric default null::numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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
    v_lat:=v_settings.cep_lat;
    v_lng:=coalesce(v_settings.cep_lng,v_settings.cep_lon);

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

revoke all on function public.validar_cep_entrega(uuid,text,numeric,numeric) from public;
grant execute on function public.validar_cep_entrega(uuid,text,numeric,numeric) to anon,authenticated;
