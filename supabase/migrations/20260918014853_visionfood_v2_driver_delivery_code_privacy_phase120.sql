
alter table public.orders
  add column if not exists bairro_nome text not null default '';

create table if not exists private.delivery_code_attempts (
  order_id uuid not null,
  entregador_id uuid not null,
  attempts integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key(order_id,entregador_id)
);

revoke all on table private.delivery_code_attempts
  from public,anon,authenticated;
grant select,insert,update,delete
  on table private.delivery_code_attempts
  to service_role;

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

  select x.id,x.order_number
    into _id,_number
  from public.create_order_checkout(
    _organization_id,_customer_name,_customer_phone,_customer_cpf,_order_type,
    _delivery_address,_delivery_reference,_delivery_recipient,_bairro_id,_bairro_nome,
    _server_fee,_items,_total,_payment_method,_scheduled_for,_coupon_code
  ) x;

  update public.orders
     set bairro_nome=left(btrim(coalesce(_bairro_nome,'')),120)
   where orders.id=_id;

  return query select _id,_number;
end
$$;

revoke all on function public.create_order_checkout_v2(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) from public;
grant execute on function public.create_order_checkout_v2(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) to anon,authenticated,service_role;

create or replace function public.entregador_orders_session(_session_token text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_e public.entregadores%rowtype;
  v_rows jsonb;
begin
  v_e:=public.entregador_session_driver(_session_token);
  if v_e.id is null then
    return jsonb_build_object('ok',false,'reason','invalid_session');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'customer_name',o.customer_name,
        'customer_phone',o.customer_phone,
        'delivery_address',o.delivery_address,
        'delivery_reference',o.delivery_reference,
        'delivery_recipient',o.delivery_recipient,
        'bairro_nome',o.bairro_nome,
        'items',coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name',i->>'name',
              'quantity',coalesce(i->'quantity','1'::jsonb)
            )
          )
          from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) i
        ),'[]'::jsonb),
        'total',o.total,
        'status',o.status,
        'order_type',o.order_type,
        'created_at',o.created_at
      )
      order by o.created_at desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.orders o
  where o.organization_id=v_e.organization_id
    and o.entregador_id=v_e.id
    and o.status in ('preparing','out_for_delivery','ready','delivered')
    and o.created_at>now()-interval '7 days';

  return jsonb_build_object('ok',true,'orders',v_rows);
end
$$;

revoke all on function public.entregador_orders_session(text)
  from public;
grant execute on function public.entregador_orders_session(text)
  to anon,authenticated,service_role;

create or replace function public.entregador_available_orders_session(_session_token text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_e public.entregadores%rowtype;
  v_mode text;
  v_rows jsonb;
begin
  v_e:=public.entregador_session_driver(_session_token);
  if v_e.id is null then
    return jsonb_build_object('ok',false,'reason','invalid_session');
  end if;

  select coalesce(delivery_assignment_mode,'manual')
    into v_mode
  from public.settings
  where organization_id=v_e.organization_id
  limit 1;

  if v_mode<>'free' then
    return jsonb_build_object(
      'ok',true,
      'mode',coalesce(v_mode,'manual'),
      'orders','[]'::jsonb
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'bairro_nome',o.bairro_nome,
        'total',o.total,
        'status',o.status,
        'order_type',o.order_type,
        'created_at',o.created_at
      )
      order by o.created_at asc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.orders o
  where o.organization_id=v_e.organization_id
    and o.order_type in ('delivery','viagem')
    and o.entregador_id is null
    and o.status='ready'
    and o.created_at>now()-interval '1 day';

  return jsonb_build_object('ok',true,'mode',v_mode,'orders',v_rows);
end
$$;

revoke all on function public.entregador_available_orders_session(text)
  from public;
grant execute on function public.entregador_available_orders_session(text)
  to anon,authenticated,service_role;

create or replace function public.confirm_delivery_with_code_session(
  _session_token text,
  _order_id uuid,
  _code text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_e public.entregadores%rowtype;
  v_order public.orders%rowtype;
  v_attempt private.delivery_code_attempts%rowtype;
  v_next_attempts integer;
begin
  v_e:=public.entregador_session_driver(_session_token);
  if v_e.id is null then
    return jsonb_build_object('ok',false,'reason','invalid_session');
  end if;

  if _code is null or _code !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok',false,'reason','invalid_code_format');
  end if;

  select * into v_order
  from public.orders
  where id=_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','order_not_found');
  end if;

  if v_order.organization_id<>v_e.organization_id then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if v_order.order_type not in ('delivery','viagem') then
    return jsonb_build_object('ok',false,'reason','not_delivery_order');
  end if;

  if v_order.entregador_id is distinct from v_e.id then
    return jsonb_build_object('ok',false,'reason','not_assigned');
  end if;

  if v_order.status='delivered' then
    return jsonb_build_object('ok',false,'reason','already_delivered');
  end if;

  if v_order.status='cancelled' then
    return jsonb_build_object('ok',false,'reason','cancelled');
  end if;

  if v_order.status<>'out_for_delivery' then
    return jsonb_build_object(
      'ok',false,
      'reason','not_out_for_delivery',
      'current_status',v_order.status
    );
  end if;

  select * into v_attempt
  from private.delivery_code_attempts
  where order_id=_order_id
    and entregador_id=v_e.id
  for update;

  if found
     and v_attempt.blocked_until is not null
     and v_attempt.blocked_until>now() then
    return jsonb_build_object(
      'ok',false,
      'reason','too_many_attempts',
      'retry_after_seconds',
      greatest(1,ceil(extract(epoch from (v_attempt.blocked_until-now())))::integer)
    );
  end if;

  if coalesce(v_order.delivery_code,'')=''
     or v_order.delivery_code<>_code then
    v_next_attempts:=case
      when found and coalesce(v_attempt.blocked_until,'-infinity'::timestamptz)<=now()
        then coalesce(v_attempt.attempts,0)+1
      else 1
    end;

    insert into private.delivery_code_attempts(
      order_id,entregador_id,attempts,blocked_until,updated_at
    )
    values(
      _order_id,
      v_e.id,
      v_next_attempts,
      case when v_next_attempts>=5 then now()+interval '10 minutes' else null end,
      now()
    )
    on conflict(order_id,entregador_id) do update
      set attempts=excluded.attempts,
          blocked_until=excluded.blocked_until,
          updated_at=now();

    if v_next_attempts>=5 then
      return jsonb_build_object(
        'ok',false,
        'reason','too_many_attempts',
        'retry_after_seconds',600
      );
    end if;

    return jsonb_build_object(
      'ok',false,
      'reason','invalid_code',
      'remaining_attempts',5-v_next_attempts
    );
  end if;

  delete from private.delivery_code_attempts
  where order_id=_order_id
    and entregador_id=v_e.id;

  update public.orders
     set status='delivered',
         updated_at=now()
   where id=_order_id;

  insert into public.entregas_log(
    order_id,organization_id,entregador_id,delivered_at
  )
  values(
    _order_id,v_order.organization_id,v_e.id,now()
  )
  on conflict(order_id) do nothing;

  return jsonb_build_object('ok',true,'status','delivered');
end
$$;

revoke all on function public.confirm_delivery_with_code_session(text,uuid,text)
  from public;
grant execute on function public.confirm_delivery_with_code_session(text,uuid,text)
  to anon,authenticated,service_role;
