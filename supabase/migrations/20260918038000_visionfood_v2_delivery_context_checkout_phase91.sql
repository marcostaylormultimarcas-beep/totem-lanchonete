-- Phase 91: secure delivery context for future non-bairro modes.
-- Existing 6/16-arg RPCs remain temporarily for production compatibility until frontend cutover is deployed.
create or replace function public.quote_order_checkout(
 _organization_id uuid,
 _order_type text default 'local',
 _bairro_id uuid default null,
 _delivery_fee numeric default 0,
 _items jsonb default '[]'::jsonb,
 _coupon_code text default '',
 _delivery_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  _mode text;
  _server_fee numeric:=coalesce(_delivery_fee,0);
  _delivery jsonb;
  _cep text;
begin
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
end$$;

create or replace function public.create_order_checkout(
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
) returns table(id uuid,order_number text)
language plpgsql security definer set search_path='' as $$
declare
  _quote jsonb;
  _server_fee numeric;
begin
  _quote:=public.quote_order_checkout(
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
end$$;

revoke all on function public.quote_order_checkout(uuid,text,uuid,numeric,jsonb,text,jsonb) from public;
grant execute on function public.quote_order_checkout(uuid,text,uuid,numeric,jsonb,text,jsonb) to anon,authenticated,service_role;
revoke all on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb) from public;
grant execute on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb) to anon,authenticated,service_role;
