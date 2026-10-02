
alter table public.settings
  add column if not exists special_closures jsonb not null default '[]'::jsonb;

alter table public.settings
  drop constraint if exists settings_special_closures_array_check;

alter table public.settings
  add constraint settings_special_closures_array_check
  check (jsonb_typeof(special_closures) = 'array');

create or replace function public.visionfood_public_storefront_config(_org uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $function$
declare
  v_result jsonb;
begin
  if _org is null then
    raise exception 'invalid_organization';
  end if;

  if coalesce(
    (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
    true
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
    'special_closures',coalesce(s.special_closures,'[]'::jsonb),
    'emergency_closed',coalesce(s.emergency_closed,false),
    'closed_message',coalesce(nullif(s.closed_message,''),'Lanchonete fechada no momento'),
    'scheduling_enabled',coalesce(s.scheduling_enabled,true),
    'balanca_baud_rate',case
      when s.balanca_baud_rate in (4800,9600) then s.balanca_baud_rate
      else 9600
    end,
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
as $function$
declare
  _quote jsonb;
  _server_fee numeric;
  _id uuid;
  _number text;
  _method text;
  _pay_cash boolean:=true;
  _pay_pix boolean:=true;
  _pay_terminal boolean:=false;
  _pix_key text:='';
  _special_closures jsonb:='[]'::jsonb;
  _target_date date;
  _loyalty_subtotal numeric:=0;
  _loyalty_discount numeric:=0;
  _loyalty_fee numeric:=0;
  _loyalty_eligible numeric:=0;
begin
  if nullif(btrim(coalesce(_customer_name,'')),'') is null or length(btrim(_customer_name))>120 then
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

  _method:=lower(btrim(coalesce(_payment_method,'')));
  if _method not in ('cash','pix','terminal') then
    raise exception 'invalid payment_method';
  end if;

  select
    coalesce(s.pay_cash_enabled,true),
    coalesce(s.pay_pix_enabled,true),
    coalesce(s.pay_card_terminal_enabled,false),
    coalesce(s.pix_key_manual,''),
    coalesce(s.special_closures,'[]'::jsonb)
  into _pay_cash,_pay_pix,_pay_terminal,_pix_key,_special_closures
  from public.settings s
  where s.organization_id=_organization_id
  limit 1;

  if not found then
    _pay_cash:=true;
    _pay_pix:=false;
    _pay_terminal:=false;
    _pix_key:='';
    _special_closures:='[]'::jsonb;
  end if;

  if (_method='cash' and not _pay_cash)
     or (_method='pix' and (not _pay_pix or nullif(btrim(_pix_key),'') is null))
     or (_method='terminal' and not _pay_terminal) then
    raise exception 'payment_method_disabled';
  end if;

  _target_date := case
    when _scheduled_for is null
      then (now() at time zone 'America/Sao_Paulo')::date
    else (_scheduled_for at time zone 'America/Sao_Paulo')::date
  end;

  if exists (
    select 1
    from jsonb_array_elements(_special_closures) c
    where c->>'date'=to_char(_target_date,'YYYY-MM-DD')
  ) then
    raise exception 'store_closed_special_date';
  end if;

  _quote:=public.quote_order_checkout_v2(
    _organization_id,_order_type,_bairro_id,_delivery_fee,_items,_coupon_code,_delivery_context
  );
  _server_fee:=coalesce((_quote->>'delivery_fee')::numeric,0);
  _loyalty_subtotal:=greatest(coalesce((_quote->>'subtotal')::numeric,0),0);
  _loyalty_discount:=greatest(coalesce((_quote->>'discount')::numeric,0),0);
  _loyalty_fee:=greatest(coalesce((_quote->>'delivery_fee')::numeric,0),0);
  _loyalty_eligible:=round(greatest(_loyalty_subtotal-_loyalty_discount,0),2);

  select x.id,x.order_number
    into _id,_number
  from public.create_order_checkout(
    _organization_id,_customer_name,_customer_phone,_customer_cpf,_order_type,
    _delivery_address,_delivery_reference,_delivery_recipient,_bairro_id,_bairro_nome,
    _server_fee,_items,_total,_method,_scheduled_for,_coupon_code
  ) x;

  update public.orders
     set bairro_nome=left(btrim(coalesce(_bairro_nome,'')),120),
         loyalty_subtotal=round(_loyalty_subtotal,2),
         loyalty_discount=round(_loyalty_discount,2),
         loyalty_delivery_fee=round(_loyalty_fee,2),
         loyalty_eligible_amount=_loyalty_eligible
   where orders.id=_id;

  return query select _id,_number;
end
$function$;
