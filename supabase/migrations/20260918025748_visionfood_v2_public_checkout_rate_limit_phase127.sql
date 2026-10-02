
create table if not exists private.checkout_rate_limits (
  scope_key text primary key,
  window_started_at timestamptz not null,
  successful_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_checkout_rate_limits_updated_at
  on private.checkout_rate_limits(updated_at);

revoke all on table private.checkout_rate_limits
  from public,anon,authenticated;
grant select,insert,update,delete
  on table private.checkout_rate_limits
  to service_role;

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
  v_phone text;
  v_org_key text;
  v_phone_key text;
  v_org_limit private.checkout_rate_limits%rowtype;
  v_phone_limit private.checkout_rate_limits%rowtype;
begin
  if _organization_id is null then
    raise exception 'invalid_organization';
  end if;

  v_phone:=regexp_replace(coalesce(_customer_phone,''),'[^0-9]','','g');

  perform public.quote_order_checkout_v2(
    _organization_id,_order_type,_bairro_id,_delivery_fee,_items,_coupon_code,_delivery_context
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('visionfood:checkout:'||_organization_id::text,0)
  );

  v_org_key:='org:'||_organization_id::text;

  select * into v_org_limit
  from private.checkout_rate_limits
  where scope_key=v_org_key
  for update;

  if found and v_org_limit.window_started_at<=now()-interval '1 minute' then
    update private.checkout_rate_limits
       set window_started_at=now(),successful_count=0,updated_at=now()
     where scope_key=v_org_key
    returning * into v_org_limit;
  end if;

  if found and v_org_limit.successful_count>=120 then
    raise exception 'checkout_rate_limited';
  end if;

  if length(v_phone)>=8 then
    v_phone_key:='phone:'||encode(
      extensions.digest(_organization_id::text||E'\n'||v_phone,'sha256'),
      'hex'
    );

    select * into v_phone_limit
    from private.checkout_rate_limits
    where scope_key=v_phone_key
    for update;

    if found and v_phone_limit.window_started_at<=now()-interval '2 minutes' then
      update private.checkout_rate_limits
         set window_started_at=now(),successful_count=0,updated_at=now()
       where scope_key=v_phone_key
      returning * into v_phone_limit;
    end if;

    if found and v_phone_limit.successful_count>=5 then
      raise exception 'checkout_phone_rate_limited';
    end if;
  end if;

  select x.id,x.order_number
    into v_id,v_number
  from public.create_order_checkout_v2(
    _organization_id,_customer_name,v_phone,_customer_cpf,_order_type,
    _delivery_address,_delivery_reference,_delivery_recipient,_bairro_id,_bairro_nome,
    _delivery_fee,_items,_total,_payment_method,_scheduled_for,_coupon_code,_delivery_context
  ) x;

  insert into private.checkout_rate_limits(
    scope_key,window_started_at,successful_count,updated_at
  )
  values(v_org_key,now(),1,now())
  on conflict(scope_key) do update
    set successful_count=private.checkout_rate_limits.successful_count+1,
        updated_at=now();

  if v_phone_key is not null then
    insert into private.checkout_rate_limits(
      scope_key,window_started_at,successful_count,updated_at
    )
    values(v_phone_key,now(),1,now())
    on conflict(scope_key) do update
      set successful_count=private.checkout_rate_limits.successful_count+1,
          updated_at=now();
  end if;

  delete from private.checkout_rate_limits
  where updated_at<now()-interval '1 day';

  select coalesce(o.delivery_code,'')
    into v_code
  from public.orders o
  where o.id=v_id;

  return query
  select v_id,v_number,
         case when _order_type in ('delivery','viagem') then v_code else '' end;
end
$$;

revoke all on function public.create_order_checkout_v3(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) from public;
grant execute on function public.create_order_checkout_v3(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) to anon,authenticated,service_role;
