-- VisionFood V2: cancellation must restore the direct product-stock deltas
-- actually consumed by the sale, independent of later product configuration.
-- Additive migration only. Historical migrations remain untouched.
--
-- Contract:
-- - checkout persists one private aggregated ledger row per directly managed product;
-- - the ledger amount is the exact direct-stock delta consumed at checkout time;
-- - cancellation restores only from that historical ledger;
-- - current manage_stock / sold_by_weight never reconstruct past direct consumption;
-- - legacy committed orders without a trustworthy snapshot fail closed;
-- - product locks are acquired in deterministic UUID order after recipe ingredients;
-- - missing historical product rows fail closed instead of silently completing;
-- - order row lock + stock_restocked_at keep restock idempotent;
-- - any failure aborts the surrounding cancellation transaction before completion markers persist.

alter table public.orders
  add column if not exists stock_snapshot_version smallint;

comment on column public.orders.stock_snapshot_version is
  'Version of the private historical direct product-stock snapshot. NULL means no trustworthy historical snapshot is available.';

create table if not exists public.visionfood_order_product_stock_ledger (
  order_id uuid not null,
  organization_id uuid not null,
  product_id uuid not null,
  amount numeric not null check (amount>0),
  created_at timestamptz not null default now(),
  primary key(order_id,product_id),
  constraint visionfood_order_product_stock_ledger_order_fk
    foreign key(order_id)
    references public.orders(id)
    on delete cascade
    deferrable initially deferred
);

comment on table public.visionfood_order_product_stock_ledger is
  'Private immutable ledger of exact direct product-stock deltas consumed by an order. product_id intentionally has no FK so a deleted historical id remains detectable during cancellation.';

alter table public.visionfood_order_product_stock_ledger enable row level security;

revoke all on table public.visionfood_order_product_stock_ledger
  from public,anon,authenticated;

grant all on table public.visionfood_order_product_stock_ledger
  to service_role;


create or replace function public.visionfood_decrement_stock_from_order()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  item jsonb;
  pid uuid;
  qty numeric;
  weight numeric;
  p public.products%rowtype;
  rec record;
begin
  if new.id is null then
    raise exception 'missing order id for product stock snapshot';
  end if;

  -- Version 1 is authoritative even when this order consumes no direct product
  -- stock. Zero ledger rows then intentionally means a zero direct-stock delta.
  new.stock_snapshot_version:=1;

  if new.items is null or jsonb_typeof(new.items)<>'array' then
    new.stock_committed_at:=now();
    return new;
  end if;

  -- Lock the complete product set first and always in UUID order. This runs
  -- after the recipe-stock BEFORE INSERT trigger, preserving ingredient ->
  -- product hierarchy while removing item-order-dependent product locking.
  perform p.id
  from public.products p
  where p.organization_id=new.organization_id
    and p.id in (
      select distinct coalesce(
        nullif(item_value->>'product_id','')::uuid,
        nullif(item_value->>'id','')::uuid,
        nullif(item_value#>>'{product,id}','')::uuid
      )
      from jsonb_array_elements(new.items) as item_rows(item_value)
    )
  order by p.id
  for update of p;

  -- Validate direct-stock lines against the checkout-time product state while
  -- the product rows are locked. Products not managed at checkout consume zero.
  for item in
    select value
    from jsonb_array_elements(new.items)
  loop
    begin
      pid:=coalesce(
        nullif(item->>'product_id','')::uuid,
        nullif(item->>'id','')::uuid,
        nullif(item#>>'{product,id}','')::uuid
      );
      qty:=coalesce(nullif(item->>'quantity','')::numeric,1);
      weight:=nullif(item->>'weight_kg','')::numeric;
    exception when invalid_text_representation then
      raise exception 'invalid stock item';
    end;

    if pid is null then
      continue;
    end if;

    select *
      into p
      from public.products
     where id=pid
       and organization_id=new.organization_id;

    if not found or coalesce(p.manage_stock,false) is not true then
      continue;
    end if;

    if coalesce(p.sold_by_weight,false) then
      if weight is null or weight<=0 then
        raise exception 'invalid stock weight for product %',pid;
      end if;
    elsif qty is null or qty<=0 then
      raise exception 'invalid stock quantity for product %',pid;
    end if;
  end loop;

  -- Reparse only after validation, aggregate repeated lines by product, then
  -- consume each historical delta exactly once. All participating rows are
  -- already locked by the deterministic prelock above.
  for rec in
    with parsed_items as (
      select
        coalesce(
          nullif(item_value->>'product_id','')::uuid,
          nullif(item_value->>'id','')::uuid,
          nullif(item_value#>>'{product,id}','')::uuid
        ) as product_id,
        coalesce(nullif(item_value->>'quantity','')::numeric,1) as quantity,
        nullif(item_value->>'weight_kg','')::numeric as weight_kg
      from jsonb_array_elements(new.items) as item_rows(item_value)
    ),
    direct_lines as (
      select
        p.id as product_id,
        case
          when coalesce(p.sold_by_weight,false) then i.weight_kg
          else i.quantity
        end as amount
      from parsed_items i
      join public.products p
        on p.id=i.product_id
       and p.organization_id=new.organization_id
      where coalesce(p.manage_stock,false) is true
    ),
    product_usage as (
      select
        product_id,
        sum(amount) as amount
      from direct_lines
      group by product_id
    )
    select
      p.id as product_id,
      p.stock_quantity,
      u.amount
    from product_usage u
    join public.products p
      on p.id=u.product_id
     and p.organization_id=new.organization_id
    where u.amount>0
    order by p.id
  loop
    if coalesce(rec.stock_quantity,0)<rec.amount then
      raise exception 'insufficient stock for product %',rec.product_id;
    end if;

    insert into public.visionfood_order_product_stock_ledger(
      order_id,organization_id,product_id,amount
    )
    values(
      new.id,new.organization_id,rec.product_id,rec.amount
    );

    update public.products
       set stock_quantity=stock_quantity-rec.amount,
           updated_at=now()
     where id=rec.product_id
       and organization_id=new.organization_id;

    if not found then
      raise exception 'missing product while consuming stock for order %',new.id;
    end if;
  end loop;

  new.stock_committed_at:=now();
  return new;
end
$$;

revoke all on function public.visionfood_decrement_stock_from_order()
  from public,anon,authenticated;


create or replace function public.visionfood_restock_cancelled_order(_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  o public.orders%rowtype;
  rec record;
begin
  select *
    into o
    from public.orders
   where id=_order_id
   for update;

  if not found
     or o.stock_committed_at is null
     or o.stock_restocked_at is not null then
    return false;
  end if;

  if coalesce(o.stock_snapshot_version,0)<>1 then
    raise exception 'missing product stock snapshot for order %',o.id;
  end if;

  if exists(
    select 1
    from public.visionfood_order_product_stock_ledger l
    where l.order_id=o.id
      and (
        l.organization_id is distinct from o.organization_id
        or l.amount is null
        or l.amount<=0
      )
  ) then
    raise exception 'invalid product stock snapshot for order %',o.id;
  end if;

  -- Acquire the complete historical direct-stock product set before any stock
  -- mutation. Product ids intentionally survive physical product deletion.
  perform p.id
  from public.products p
  join public.visionfood_order_product_stock_ledger l
    on l.product_id=p.id
   and l.organization_id=p.organization_id
  where l.order_id=o.id
    and p.organization_id=o.organization_id
  order by p.id
  for update of p;

  if exists(
    select 1
    from public.visionfood_order_product_stock_ledger l
    where l.order_id=o.id
      and l.organization_id=o.organization_id
      and not exists(
        select 1
        from public.products p
        where p.id=l.product_id
          and p.organization_id=o.organization_id
      )
  ) then
    raise exception 'missing product from stock snapshot for order %',o.id;
  end if;

  for rec in
    select
      l.product_id,
      l.amount
    from public.visionfood_order_product_stock_ledger l
    where l.order_id=o.id
      and l.organization_id=o.organization_id
    order by l.product_id
  loop
    update public.products
       set stock_quantity=stock_quantity+rec.amount,
           updated_at=now()
     where id=rec.product_id
       and organization_id=o.organization_id;

    if not found then
      raise exception 'missing product from stock snapshot for order %',o.id;
    end if;
  end loop;

  update public.orders
     set stock_restocked_at=now()
   where id=o.id;

  return true;
end
$$;

revoke all on function public.visionfood_restock_cancelled_order(uuid)
  from public,anon,authenticated;
