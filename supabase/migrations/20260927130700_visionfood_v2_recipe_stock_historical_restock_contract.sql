-- VisionFood V2: cancellation must restore the ingredient deltas actually consumed by the sale.
-- Additive migration only. Historical migrations remain untouched.
--
-- Contract:
-- - checkout persists one private, aggregated ledger row per consumed ingredient;
-- - cancellation restores from that historical ledger, never from current recipes or sold_by_weight;
-- - legacy committed orders without a trustworthy snapshot fail closed;
-- - ingredient locks remain deterministic and are all acquired before restock mutations;
-- - the existing order row lock + ingredient_stock_restocked_at keep restock idempotent;
-- - any failure aborts the cancellation statement/transaction before a completion marker can persist.

alter table public.orders
  add column if not exists ingredient_stock_snapshot_version smallint;

comment on column public.orders.ingredient_stock_snapshot_version is
  'Version of the private historical ingredient-consumption snapshot. NULL means no trustworthy historical snapshot is available.';

create table if not exists public.visionfood_order_ingredient_stock_ledger (
  order_id uuid not null,
  organization_id uuid not null,
  ingredient_id uuid not null,
  amount numeric not null check (amount>0),
  created_at timestamptz not null default now(),
  primary key(order_id,ingredient_id),
  constraint visionfood_order_ingredient_stock_ledger_order_fk
    foreign key(order_id)
    references public.orders(id)
    on delete cascade
    deferrable initially deferred
);

alter table public.visionfood_order_ingredient_stock_ledger enable row level security;

revoke all on table public.visionfood_order_ingredient_stock_ledger
  from public,anon,authenticated;

grant all on table public.visionfood_order_ingredient_stock_ledger
  to service_role;


create or replace function public.visionfood_consume_recipe_stock()
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
  is_by_weight boolean;
  multiplier numeric;
  product_usage jsonb:='{}'::jsonb;
  rec record;
  needed numeric;
  new_stock numeric;
begin
  if new.id is null then
    raise exception 'missing order id for ingredient stock snapshot';
  end if;

  -- Version 1 means this order has a trustworthy historical source even when
  -- it consumed no recipe ingredients (zero ledger rows is then intentional).
  new.ingredient_stock_snapshot_version:=1;

  if new.items is null or jsonb_typeof(new.items)<>'array' then
    new.ingredient_stock_committed_at:=now();
    return new;
  end if;

  -- Validate each line first and collapse repeated product lines to one
  -- authoritative multiplier before any ingredient row is touched.
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
      raise exception 'invalid ingredient stock item';
    end;

    if pid is null then
      continue;
    end if;

    select coalesce(p.sold_by_weight,false)
      into is_by_weight
      from public.products p
     where p.id=pid
       and p.organization_id=new.organization_id;

    if not found then
      continue;
    end if;

    if is_by_weight and (weight is null or weight<=0) then
      raise exception 'invalid ingredient stock weight for product %',pid;
    end if;

    if not is_by_weight and qty<=0 then
      continue;
    end if;

    multiplier:=case when is_by_weight then weight else qty end;

    product_usage:=jsonb_set(
      product_usage,
      array[pid::text],
      to_jsonb(
        coalesce(nullif(product_usage->>pid::text,'')::numeric,0)+multiplier
      ),
      true
    );
  end loop;

  -- Preserve the deterministic global lock set introduced by the concurrency
  -- contract before any ingredient UPDATE can fire availability/alert triggers.
  perform i.id
  from public.ingredientes i
  where i.organization_id=new.organization_id
    and exists(
      select 1
      from public.receitas r
      join jsonb_each(product_usage) u
        on coalesce(r.product_id,r.produto_id)=u.key::uuid
      where r.organization_id=new.organization_id
        and coalesce(r.ingrediente_id,r.ingredient_id)=i.id
        and greatest(coalesce(r.quantidade,0),0)>0
        and u.value::text::numeric>0
    )
  order by i.id
  for update of i;

  for rec in
    with product_usage as (
      select
        u.key::uuid as product_id,
        u.value::text::numeric as multiplier
      from jsonb_each(product_usage) u
    ),
    ingredient_need as (
      select
        coalesce(r.ingrediente_id,r.ingredient_id) as ingrediente_id,
        sum(
          greatest(coalesce(r.quantidade,0),0)*u.multiplier
        ) as needed,
        min(u.product_id::text)::uuid as source_product_id
      from product_usage u
      join public.receitas r
        on coalesce(r.product_id,r.produto_id)=u.product_id
      where r.organization_id=new.organization_id
        and coalesce(r.ingrediente_id,r.ingredient_id) is not null
      group by coalesce(r.ingrediente_id,r.ingredient_id)
    )
    select
      i.id as ingrediente_id,
      i.nome,
      i.estoque_atual,
      coalesce(i.estoque_minimo,0) as estoque_minimo,
      n.needed,
      n.source_product_id
    from ingredient_need n
    join public.ingredientes i
      on i.id=n.ingrediente_id
     and i.organization_id=new.organization_id
    where n.needed>0
    order by i.id
    for update of i
  loop
    needed:=rec.needed;

    if coalesce(rec.estoque_atual,0)<needed then
      raise exception 'insufficient ingredient stock: %',rec.nome;
    end if;

    -- This row is the historical source of truth for cancellation. It records
    -- the exact aggregated delta that this checkout is about to consume.
    insert into public.visionfood_order_ingredient_stock_ledger(
      order_id,organization_id,ingredient_id,amount
    )
    values(
      new.id,new.organization_id,rec.ingrediente_id,needed
    );

    new_stock:=rec.estoque_atual-needed;

    update public.ingredientes
       set estoque_atual=new_stock,
           disponivel=(new_stock>0),
           updated_at=now()
     where id=rec.ingrediente_id;

    if new_stock<=0 then
      update public.products p
         set ingredient_stock_blocked=case
               when p.available then true
               else p.ingredient_stock_blocked
             end,
             available=false,
             updated_at=now()
       where p.organization_id=new.organization_id
         and p.id in (
           select coalesce(r2.product_id,r2.produto_id)
           from public.receitas r2
           where coalesce(r2.ingrediente_id,r2.ingredient_id)=rec.ingrediente_id
         );

      if not exists(
        select 1 from public.alertas_estoque a
        where a.organization_id=new.organization_id
          and a.ingrediente_id=rec.ingrediente_id
          and a.resolvido=false
          and a.tipo='ruptura'
      ) then
        insert into public.alertas_estoque(
          organization_id,ingrediente_id,product_id,tipo,mensagem
        )
        values(
          new.organization_id,rec.ingrediente_id,rec.source_product_id,'ruptura',
          'Ingrediente "'||rec.nome||'" esgotado. Produtos relacionados foram bloqueados.'
        );
      end if;

    elsif new_stock<=rec.estoque_minimo then
      if not exists(
        select 1 from public.alertas_estoque a
        where a.organization_id=new.organization_id
          and a.ingrediente_id=rec.ingrediente_id
          and a.resolvido=false
          and a.tipo='minimo'
      ) then
        insert into public.alertas_estoque(
          organization_id,ingrediente_id,product_id,tipo,mensagem
        )
        values(
          new.organization_id,rec.ingrediente_id,rec.source_product_id,'minimo',
          'Ingrediente "'||rec.nome||'" atingiu o estoque mínimo.'
        );
      end if;
    end if;
  end loop;

  new.ingredient_stock_committed_at:=now();
  return new;
end
$$;

revoke all on function public.visionfood_consume_recipe_stock()
  from public,anon,authenticated;


create or replace function public.visionfood_restock_recipe_stock(_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  o public.orders%rowtype;
  rec record;
begin
  select * into o
  from public.orders
  where id=_order_id
  for update;

  if not found
     or o.ingredient_stock_committed_at is null
     or o.ingredient_stock_restocked_at is not null then
    return false;
  end if;

  -- A committed legacy order may have consumed ingredients under an older
  -- function, but its exact deltas cannot be reconstructed safely after recipe
  -- or product-mode edits. Do not invent history and do not mark it restored.
  if coalesce(o.ingredient_stock_snapshot_version,0)<>1 then
    raise exception 'missing ingredient stock snapshot for order %',o.id;
  end if;

  if exists(
    select 1
    from public.visionfood_order_ingredient_stock_ledger l
    where l.order_id=o.id
      and (
        l.organization_id is distinct from o.organization_id
        or l.amount is null
        or l.amount<=0
      )
  ) then
    raise exception 'invalid ingredient stock snapshot for order %',o.id;
  end if;

  -- Acquire the complete historical ingredient set first, in the same stable
  -- UUID order used by checkout. No stock mutation occurs before this finishes.
  perform i.id
  from public.ingredientes i
  join public.visionfood_order_ingredient_stock_ledger l
    on l.ingredient_id=i.id
   and l.organization_id=i.organization_id
  where l.order_id=o.id
    and i.organization_id=o.organization_id
  order by i.id
  for update of i;

  -- Ingredient ids intentionally have no FK from the ledger: the historical
  -- id survives deletion. If the real ingredient row was deleted, restoration
  -- is impossible, so cancellation fails closed instead of crediting another row.
  if exists(
    select 1
    from public.visionfood_order_ingredient_stock_ledger l
    where l.order_id=o.id
      and l.organization_id=o.organization_id
      and not exists(
        select 1
        from public.ingredientes i
        where i.id=l.ingredient_id
          and i.organization_id=o.organization_id
      )
  ) then
    raise exception 'missing ingredient from stock snapshot for order %',o.id;
  end if;

  for rec in
    select
      l.ingredient_id,
      l.amount
    from public.visionfood_order_ingredient_stock_ledger l
    where l.order_id=o.id
      and l.organization_id=o.organization_id
    order by l.ingredient_id
  loop
    update public.ingredientes
       set estoque_atual=estoque_atual+rec.amount,
           disponivel=true,
           updated_at=now()
     where id=rec.ingredient_id
       and organization_id=o.organization_id;

    if not found then
      raise exception 'missing ingredient from stock snapshot for order %',o.id;
    end if;
  end loop;

  update public.orders
     set ingredient_stock_restocked_at=now()
   where id=o.id;

  return true;
end
$$;

revoke all on function public.visionfood_restock_recipe_stock(uuid)
  from public,anon,authenticated;
