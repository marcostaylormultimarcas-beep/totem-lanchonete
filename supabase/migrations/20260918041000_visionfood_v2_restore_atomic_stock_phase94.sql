-- Phase 94: restore stock columns and enforce atomic stock decrement on order insert.
alter table public.products
  add column if not exists manage_stock boolean not null default false,
  add column if not exists stock_quantity numeric not null default 0,
  add column if not exists low_stock_threshold numeric not null default 5;

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
  amount numeric;
  p public.products%rowtype;
begin
  if new.items is null or jsonb_typeof(new.items)<>'array' then
    return new;
  end if;

  for item in select value from jsonb_array_elements(new.items)
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

    if pid is null then continue; end if;

    select * into p
      from public.products
     where id=pid and organization_id=new.organization_id
     for update;

    if not found or coalesce(p.manage_stock,false) is not true then
      continue;
    end if;

    amount:=case
      when coalesce(p.sold_by_weight,false) and weight is not null then weight
      else qty
    end;

    if amount is null or amount<=0 then
      raise exception 'invalid stock quantity for product %',pid;
    end if;

    if coalesce(p.stock_quantity,0)<amount then
      raise exception 'insufficient stock for product %',pid;
    end if;

    update public.products
       set stock_quantity=stock_quantity-amount,
           updated_at=now()
     where id=pid;
  end loop;

  return new;
end$$;

revoke all on function public.visionfood_decrement_stock_from_order() from public,anon,authenticated;

drop trigger if exists trg_visionfood_decrement_stock_on_order on public.orders;
create trigger trg_visionfood_decrement_stock_on_order
after insert on public.orders
for each row execute function public.visionfood_decrement_stock_from_order();
