
create or replace function public.create_order_checkout_v3(
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
returns table(id uuid,order_number text,delivery_code text)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_number text;
  v_code text;
begin
  select x.id,x.order_number
    into v_id,v_number
  from public.create_order_checkout_v2(
    _organization_id,_customer_name,_customer_phone,_customer_cpf,_order_type,
    _delivery_address,_delivery_reference,_delivery_recipient,_bairro_id,_bairro_nome,
    _delivery_fee,_items,_total,_payment_method,_scheduled_for,_coupon_code,_delivery_context
  ) x;

  select coalesce(o.delivery_code,'')
    into v_code
  from public.orders o
  where o.id=v_id;

  return query
  select v_id,v_number,
         case
           when _order_type in ('delivery','viagem') then v_code
           else ''
         end;
end
$$;

revoke all on function public.create_order_checkout_v3(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) from public;
grant execute on function public.create_order_checkout_v3(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) to anon,authenticated,service_role;
