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
  _id uuid;
  _number text;
  _method text;
  _pay_cash boolean := true;
  _pay_pix boolean := true;
  _pay_terminal boolean := false;
  _pix_key text := '';
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

  _method := lower(btrim(coalesce(_payment_method,'')));
  if _method not in ('cash','pix','terminal') then
    raise exception 'invalid payment_method';
  end if;

  select
    coalesce(s.pay_cash_enabled,true),
    coalesce(s.pay_pix_enabled,true),
    coalesce(s.pay_card_terminal_enabled,false),
    coalesce(s.pix_key_manual,'')
  into _pay_cash,_pay_pix,_pay_terminal,_pix_key
  from public.settings s
  where s.organization_id=_organization_id
  limit 1;

  if not found then
    _pay_cash := true;
    _pay_pix := false;
    _pay_terminal := false;
    _pix_key := '';
  end if;

  if (_method='cash' and not _pay_cash)
     or (_method='pix' and (not _pay_pix or nullif(btrim(_pix_key),'') is null))
     or (_method='terminal' and not _pay_terminal) then
    raise exception 'payment_method_disabled';
  end if;

  _quote:=public.quote_order_checkout_v2(
    _organization_id,_order_type,_bairro_id,_delivery_fee,_items,_coupon_code,_delivery_context
  );
  _server_fee:=coalesce((_quote->>'delivery_fee')::numeric,0);

  select x.id,x.order_number
    into _id,_number
  from public.create_order_checkout(
    _organization_id,_customer_name,_customer_phone,_customer_cpf,_order_type,
    _delivery_address,_delivery_reference,_delivery_recipient,_bairro_id,_bairro_nome,
    _server_fee,_items,_total,_method,_scheduled_for,_coupon_code
  ) x;

  update public.orders
     set bairro_nome=left(btrim(coalesce(_bairro_nome,'')),120)
   where orders.id=_id;

  return query select _id,_number;
end
$$;
