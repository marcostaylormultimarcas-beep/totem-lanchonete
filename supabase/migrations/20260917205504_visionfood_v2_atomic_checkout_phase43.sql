-- VisionFood V2 phase 43: allocate order number and create order in one transaction.

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
  _scheduled_for timestamptz default null
)
returns table(id uuid, order_number text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _n bigint;
  _candidate text;
  _id uuid;
begin
  if _organization_id is null or not exists (select 1 from public.organizations o where o.id = _organization_id) then
    raise exception 'organization_id is invalid';
  end if;
  if nullif(btrim(_customer_name), '') is null then
    raise exception 'customer_name is required';
  end if;
  if _order_type not in ('local', 'viagem', 'delivery') then
    raise exception 'invalid order_type';
  end if;
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;
  if _total is null or _total < 0 then
    raise exception 'total must be non-negative';
  end if;
  if _delivery_fee is null or _delivery_fee < 0 then
    raise exception 'delivery_fee must be non-negative';
  end if;

  loop
    insert into public.order_number_counters(organization_id, last_number)
    values (_organization_id, 1)
    on conflict (organization_id) do update
      set last_number = public.order_number_counters.last_number + 1,
          updated_at = now()
    returning last_number into _n;

    _candidate := lpad(_n::text, 3, '0');
    exit when not exists (
      select 1 from public.orders o
      where o.organization_id = _organization_id
        and o.order_number = _candidate
    );
  end loop;

  insert into public.orders (
    organization_id, order_number, customer_name, customer_phone, customer_cpf,
    order_type, delivery_address, delivery_reference, delivery_recipient,
    bairro_id, bairro_nome, delivery_fee, items, total, status,
    payment_method, user_id, scheduled_for
  ) values (
    _organization_id, _candidate, btrim(_customer_name), coalesce(_customer_phone, ''), coalesce(_customer_cpf, ''),
    _order_type, coalesce(_delivery_address, ''), coalesce(_delivery_reference, ''), coalesce(_delivery_recipient, ''),
    _bairro_id, coalesce(_bairro_nome, ''), coalesce(_delivery_fee, 0), _items, _total, 'pending',
    coalesce(_payment_method, ''), auth.uid(), _scheduled_for
  ) returning orders.id into _id;

  return query select _id, _candidate;
end;
$$;

revoke all on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz) from public;
grant execute on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz) to anon, authenticated;
