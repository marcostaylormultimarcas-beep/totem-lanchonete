-- Phase 46B: align delivery checkout with the real kiosk/admin contract.
-- Uses taxas_entrega for neighborhood delivery and restores validar_cep_entrega.

CREATE OR REPLACE FUNCTION public.validar_cep_entrega(_org uuid, _cep text, _lat numeric DEFAULT NULL::numeric, _lng numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings public.settings%rowtype;
  v_cep public.cep_atendidos%rowtype;
  v_mode text;
  v_lat numeric;
  v_lng numeric;
  v_dist numeric;
  v_taxa numeric;
  v_tempo numeric;
begin
  if _org is null then return jsonb_build_object('ok',false,'motivo','sem_configuracao'); end if;
  select * into v_settings from public.settings where organization_id=_org limit 1;
  if not found or coalesce(v_settings.delivery_enabled,true) is not true then
    return jsonb_build_object('ok',false,'motivo','sem_configuracao');
  end if;
  v_mode:=coalesce(v_settings.delivery_mode,'bairros');

  if v_mode='lista_ceps' then
    if coalesce(_cep,'') !~ '^[0-9]{8}$' then return jsonb_build_object('ok',false,'motivo','cep_invalido'); end if;
    select * into v_cep from public.cep_atendidos where organization_id=_org and regexp_replace(cep,'[^0-9]','','g')=_cep limit 1;
    if not found then return jsonb_build_object('ok',false,'motivo','fora_da_area'); end if;
    return jsonb_build_object('ok',true,'taxa',greatest(coalesce(v_cep.taxa,0),0),'tempo_min',coalesce(v_cep.tempo_min,v_cep.tempo_estimado,30),'distancia_km',null);
  elsif v_mode='raio_km' then
    v_lat:=v_settings.cep_lat; v_lng:=coalesce(v_settings.cep_lng,v_settings.cep_lon);
    if v_lat is null or v_lng is null or _lat is null or _lng is null then return jsonb_build_object('ok',false,'motivo','sem_coordenadas'); end if;
    if _lat < -90 or _lat > 90 or _lng < -180 or _lng > 180 then return jsonb_build_object('ok',false,'motivo','sem_coordenadas'); end if;
    v_dist:=6371*2*asin(sqrt(power(sin(radians((_lat-v_lat)/2)),2)+cos(radians(v_lat))*cos(radians(_lat))*power(sin(radians((_lng-v_lng)/2)),2)));
    if v_dist > greatest(coalesce(v_settings.delivery_raio_km,0),0) then return jsonb_build_object('ok',false,'motivo','fora_do_raio','distancia_km',round(v_dist,2)); end if;
    v_taxa:=greatest(coalesce(v_settings.delivery_taxa_base,0),0)+greatest(coalesce(v_settings.delivery_taxa_por_km,0),0)*v_dist;
    v_tempo:=greatest(coalesce(v_settings.delivery_tempo_base_min,0),0)+greatest(coalesce(v_settings.delivery_tempo_por_km_min,0),0)*v_dist;
    return jsonb_build_object('ok',true,'taxa',round(v_taxa,2),'tempo_min',ceil(v_tempo),'distancia_km',round(v_dist,2));
  end if;
  return jsonb_build_object('ok',false,'motivo','modo_bairros');
end $function$
;
revoke all on function public.validar_cep_entrega(uuid,text,numeric,numeric) from public;
grant execute on function public.validar_cep_entrega(uuid,text,numeric,numeric) to anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_order_checkout(_organization_id uuid, _customer_name text, _customer_phone text DEFAULT ''::text, _customer_cpf text DEFAULT ''::text, _order_type text DEFAULT 'local'::text, _delivery_address text DEFAULT ''::text, _delivery_reference text DEFAULT ''::text, _delivery_recipient text DEFAULT ''::text, _bairro_id uuid DEFAULT NULL::uuid, _bairro_nome text DEFAULT ''::text, _delivery_fee numeric DEFAULT 0, _items jsonb DEFAULT '[]'::jsonb, _total numeric DEFAULT 0, _payment_method text DEFAULT ''::text, _scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, order_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 _n bigint; _candidate text; _id uuid; _item jsonb; _product public.products%rowtype; _qty numeric; _weight numeric; _extras_total numeric; _line_total numeric; _server_subtotal numeric:=0; _extra_name text; _extra_price numeric; _canonical_items jsonb:='[]'::jsonb; _org public.organizations%rowtype; _server_fee numeric:=0; _bairro public.taxas_entrega%rowtype; _max_total numeric; _delivery_mode text;
begin
 select * into _org from public.organizations where organizations.id=_organization_id;
 if not found then raise exception 'organization_id is invalid'; end if;
 if coalesce(_org.ativo,false) is not true or coalesce(_org.bloqueado,false) is true or coalesce(_org.status,'ativo')<>'ativo' or coalesce(_org.status_assinatura,'ativo')<>'ativo' then raise exception 'organization is not accepting orders'; end if;
 if nullif(btrim(_customer_name),'') is null then raise exception 'customer_name is required'; end if;
 if _order_type not in ('local','viagem','delivery') then raise exception 'invalid order_type'; end if;
 if _items is null or jsonb_typeof(_items)<>'array' or jsonb_array_length(_items)=0 then raise exception 'items must be a non-empty array'; end if;
 for _item in select value from jsonb_array_elements(_items) loop
  if nullif(_item->>'product_id','') is null then raise exception 'product_id is required'; end if;
  select * into _product from public.products where products.id=(_item->>'product_id')::uuid and products.organization_id=_organization_id and coalesce(products.available,true)=true;
  if not found then raise exception 'product is invalid or unavailable'; end if;
  _qty:=coalesce(nullif(_item->>'quantity','')::numeric,1);
  if _qty<=0 or _qty<>trunc(_qty) or _qty>100 then raise exception 'invalid quantity'; end if;
  _weight:=nullif(_item->>'weight_kg','')::numeric;
  if _weight is not null and (_weight<=0 or _weight>100) then raise exception 'invalid weight'; end if;
  _extras_total:=0;
  if jsonb_typeof(coalesce(_item->'extras','[]'::jsonb))<>'array' then raise exception 'extras must be an array'; end if;
  for _extra_name in select jsonb_array_elements_text(coalesce(_item->'extras','[]'::jsonb)) loop
   select (x->>'price')::numeric into _extra_price from jsonb_array_elements(coalesce(_product.extras,'[]'::jsonb)) x where x->>'name'=_extra_name limit 1;
   if _extra_price is null or _extra_price<0 then raise exception 'invalid extra for product'; end if;
   _extras_total:=_extras_total+_extra_price;
  end loop;
  _line_total:=round((_product.price+_extras_total)*case when _weight is not null then _weight else _qty end,2);
  _server_subtotal:=_server_subtotal+_line_total;
  _canonical_items:=_canonical_items||jsonb_build_array(jsonb_build_object('product_id',_product.id,'name',_product.name,'quantity',case when _weight is not null then 1 else _qty end,'price',_product.price,'total',_line_total,'removedIngredients',coalesce(_item->'removedIngredients','[]'::jsonb),'extras',coalesce(_item->'extras','[]'::jsonb),'weight_kg',_weight,'price_per_kg',case when _weight is not null then _product.price else null end,'sold_by_weight',(_weight is not null)));
 end loop;
 if _order_type in ('viagem','delivery') then
  select coalesce(delivery_mode,'bairros') into _delivery_mode from public.settings where organization_id=_organization_id limit 1;
  _delivery_mode:=coalesce(_delivery_mode,'bairros');
  if _delivery_mode='bairros' then
    if _bairro_id is null then raise exception 'bairro is required'; end if;
    select * into _bairro from public.taxas_entrega where id=_bairro_id and organization_id=_organization_id and ativo=true;
    if not found then raise exception 'bairro is invalid or inactive'; end if;
    _server_fee:=greatest(coalesce(_bairro.valor_taxa,_bairro.taxa_entrega,0),0);
    if abs(round(coalesce(_delivery_fee,0),2)-round(_server_fee,2))>0.01 and round(coalesce(_delivery_fee,0),2)<>0 then raise exception 'delivery fee mismatch'; end if;
  else
    if _bairro_id is not null then raise exception 'bairro_id is invalid for delivery mode'; end if;
    _server_fee:=greatest(coalesce(_delivery_fee,0),0);
  end if;
 end if;
 _max_total:=round(_server_subtotal+_server_fee,2);
 if _total is null or _total<0 or round(_total,2)>_max_total+0.01 then raise exception 'checkout total invalid'; end if;
 loop
  insert into public.order_number_counters(organization_id,last_number) values(_organization_id,1)
  on conflict(organization_id) do update set last_number=public.order_number_counters.last_number+1,updated_at=now()
  returning last_number into _n;
  _candidate:=lpad(_n::text,3,'0');
  exit when not exists(select 1 from public.orders o where o.organization_id=_organization_id and o.order_number=_candidate);
 end loop;
 insert into public.orders(organization_id,order_number,customer_name,customer_phone,customer_cpf,order_type,delivery_address,delivery_reference,delivery_recipient,items,total,status,payment_method,user_id,scheduled_for)
 values(_organization_id,_candidate,btrim(_customer_name),coalesce(_customer_phone,''),coalesce(_customer_cpf,''),_order_type,coalesce(_delivery_address,''),coalesce(_delivery_reference,''),coalesce(_delivery_recipient,''),_canonical_items,round(_total,2),'pending',coalesce(_payment_method,''),auth.uid(),_scheduled_for)
 returning orders.id into _id;
 return query select _id,_candidate;
end $function$
;
revoke all on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz) from public;
grant execute on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz) to anon,authenticated;
