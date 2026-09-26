
create or replace function public.quote_order_checkout_v2(
  _organization_id uuid,
  _order_type text default 'local',
  _bairro_id uuid default null,
  _delivery_fee numeric default 0,
  _items jsonb default '[]'::jsonb,
  _coupon_code text default '',
  _delivery_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  _mode text;
  _server_fee numeric:=coalesce(_delivery_fee,0);
  _delivery jsonb;
  _cep text;
  _item jsonb;
begin
  if _items is null
     or jsonb_typeof(_items)<>'array'
     or jsonb_array_length(_items)=0
     or jsonb_array_length(_items)>50 then
    raise exception 'items must contain between 1 and 50 rows';
  end if;

  if _delivery_context is null
     or jsonb_typeof(_delivery_context)<>'object' then
    raise exception 'delivery_context must be an object';
  end if;

  for _item in select value from jsonb_array_elements(_items)
  loop
    if jsonb_typeof(coalesce(_item->'extras','[]'::jsonb))<>'array'
       or jsonb_array_length(coalesce(_item->'extras','[]'::jsonb))>30 then
      raise exception 'invalid extras list';
    end if;

    if jsonb_typeof(coalesce(_item->'removedIngredients','[]'::jsonb))<>'array'
       or jsonb_array_length(coalesce(_item->'removedIngredients','[]'::jsonb))>50 then
      raise exception 'invalid removed ingredients list';
    end if;
  end loop;

  if _order_type in ('viagem','delivery') then
    select coalesce(s.delivery_mode,'bairros')
      into _mode
      from public.settings s
     where s.organization_id=_organization_id
     limit 1;
    _mode:=coalesce(_mode,'bairros');

    if _mode='lista_ceps' then
      _cep:=regexp_replace(coalesce(_delivery_context->>'cep',''),'[^0-9]','','g');
      if length(_cep)<>8 then raise exception 'delivery cep is required'; end if;
      _delivery:=public.validar_cep_entrega(_organization_id,_cep,null,null);
      if coalesce((_delivery->>'ok')::boolean,false) is not true then
        raise exception 'delivery area invalid: %',coalesce(_delivery->>'motivo','invalid');
      end if;
      _server_fee:=greatest(coalesce((_delivery->>'taxa')::numeric,0),0);
    elsif _mode='raio_km' then
      raise exception 'radius delivery requires server geocoding';
    end if;
  end if;

  return public.quote_order_checkout(
    _organization_id,_order_type,_bairro_id,_server_fee,_items,_coupon_code
  );
end
$$;

create or replace function public.create_order_checkout_v2(
  _organization_id uuid,
  _customer_name text,
  _customer_phone text default '',
  _customer_cpf text default '',
  _order_type text default 'local',
  _delivery_address text default '',
  _delivery_reference text default '',
  _delivery_recipient text default '',
  _bairro_id uuid default null,
  _bairro_nome text default '',
  _delivery_fee numeric default 0,
  _items jsonb default '[]'::jsonb,
  _total numeric default 0,
  _payment_method text default '',
  _scheduled_for timestamptz default null,
  _coupon_code text default '',
  _delivery_context jsonb default '{}'::jsonb
)
returns table(id uuid,order_number text)
language plpgsql
security definer
set search_path=''
as $$
declare
  _quote jsonb;
  _server_fee numeric;
begin
  if nullif(btrim(coalesce(_customer_name,'')),'') is null
     or length(btrim(_customer_name))>120 then
    raise exception 'invalid customer_name';
  end if;

  if length(coalesce(_customer_phone,''))>30
     or length(coalesce(_customer_cpf,''))>20
     or length(coalesce(_delivery_address,''))>500
     or length(coalesce(_delivery_reference,''))>300
     or length(coalesce(_delivery_recipient,''))>120
     or length(coalesce(_bairro_nome,''))>120
     or length(coalesce(_coupon_code,''))>100 then
    raise exception 'checkout field exceeds maximum length';
  end if;

  if _payment_method not in ('cash','pix','terminal') then
    raise exception 'invalid payment_method';
  end if;

  _quote:=public.quote_order_checkout_v2(
    _organization_id,_order_type,_bairro_id,_delivery_fee,_items,_coupon_code,_delivery_context
  );
  _server_fee:=coalesce((_quote->>'delivery_fee')::numeric,0);

  return query
  select *
  from public.create_order_checkout(
    _organization_id,_customer_name,_customer_phone,_customer_cpf,_order_type,
    _delivery_address,_delivery_reference,_delivery_recipient,_bairro_id,_bairro_nome,
    _server_fee,_items,_total,_payment_method,_scheduled_for,_coupon_code
  );
end
$$;

revoke insert,update,delete
  on all tables in schema public
  from anon;

alter default privileges in schema public
  revoke insert,update,delete
  on tables
  from anon;

revoke execute on function public.quote_order_checkout_v2(
  uuid,text,uuid,numeric,jsonb,text,jsonb
) from public;
grant execute on function public.quote_order_checkout_v2(
  uuid,text,uuid,numeric,jsonb,text,jsonb
) to anon,authenticated,service_role;

revoke execute on function public.create_order_checkout_v2(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) from public;
grant execute on function public.create_order_checkout_v2(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) to anon,authenticated,service_role;
