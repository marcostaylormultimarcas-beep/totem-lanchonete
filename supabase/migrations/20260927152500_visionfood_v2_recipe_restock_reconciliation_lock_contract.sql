-- VisionFood V2: keep ingredient-driven availability reconciliation and direct
-- product stock on one deterministic product lock order.
-- Additive migration only. Historical migrations remain untouched.
--
-- Proven gap:
-- - ingredient stock UPDATE fires trg_visionfood_sync_ingredient_state;
-- - that trigger can UPDATE current recipe-related products before direct-stock
--   restock/decrement obtains its own product lock set;
-- - two concurrent operations with disjoint ingredient rows but crossed related
--   and directly-managed products could therefore acquire product rows in
--   opposite orders and deadlock.
--
-- Contract:
-- - first lock every ingredient row in deterministic UUID order;
-- - then lock the complete product union in deterministic UUID order;
-- - only then mutate ingredient stock, so row triggers cannot introduce a new
--   product lock outside the already ordered set;
-- - checkout union = cart products + every current product related to any
--   ingredient that this checkout will mutate;
-- - cancellation union = current products related to historically restored
--   ingredients + products in the historical direct-stock ledger;
-- - historical ingredient delta remains sourced only from the ingredient ledger;
-- - historical direct-stock delta remains sourced only from the product ledger;
-- - current recipe graph still decides post-restock availability;
-- - existing weighted-aware availability, alerts, rollback and idempotency stay intact.

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

  new.ingredient_stock_snapshot_version:=1;

  if new.items is null or jsonb_typeof(new.items)<>'array' then
    new.ingredient_stock_committed_at:=now();
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

  -- Global hierarchy step 1: prelock every ingredient that this checkout may
  -- mutate before any ingredient UPDATE can run its availability/alert trigger.
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

  -- Global hierarchy step 2: before the first ingredient UPDATE, prelock one
  -- complete product union in UUID order:
  --   a) every cart product (covers later direct-stock decrement);
  --   b) every current product related to any ingredient this checkout mutates
  --      (covers trg_visionfood_sync_ingredient_state side effects).
  perform p.id
  from public.products p
  where p.organization_id=new.organization_id
    and (
      p.id in (
        select u.key::uuid
        from jsonb_each(product_usage) u
        where u.value::text::numeric>0
      )
      or exists(
        select 1
        from public.receitas related_recipe
        where related_recipe.organization_id=new.organization_id
          and coalesce(
            related_recipe.product_id,
            related_recipe.produto_id
          )=p.id
          and coalesce(
            related_recipe.ingrediente_id,
            related_recipe.ingredient_id
          ) in (
            select distinct coalesce(
              order_recipe.ingrediente_id,
              order_recipe.ingredient_id
            )
            from public.receitas order_recipe
            join jsonb_each(product_usage) u
              on coalesce(
                order_recipe.product_id,
                order_recipe.produto_id
              )=u.key::uuid
            where order_recipe.organization_id=new.organization_id
              and coalesce(
                order_recipe.ingrediente_id,
                order_recipe.ingredient_id
              ) is not null
              and greatest(coalesce(order_recipe.quantidade,0),0)>0
              and u.value::text::numeric>0
          )
      )
    )
  order by p.id
  for update of p;

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
        select 1
        from public.alertas_estoque a
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
        select 1
        from public.alertas_estoque a
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

  -- Global hierarchy step 1: lock the complete historical ingredient snapshot
  -- first, preserving the checkout ingredient UUID order.
  perform i.id
  from public.ingredientes i
  join public.visionfood_order_ingredient_stock_ledger l
    on l.ingredient_id=i.id
   and l.organization_id=i.organization_id
  where l.order_id=o.id
    and i.organization_id=o.organization_id
  order by i.id
  for update of i;

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

  -- Global hierarchy step 2: before restoring the first ingredient, lock the
  -- full product union in UUID order:
  --   a) every product in the CURRENT recipe graph for historical ingredients;
  --   b) every historical direct-stock product that the next restock function
  --      can mutate.
  --
  -- This intentionally separates history from current operations:
  -- ingredient amounts come only from the ingredient ledger, while the product
  -- availability rows are discovered only from the current recipe graph.
  perform p.id
  from public.products p
  where p.organization_id=o.organization_id
    and (
      exists(
        select 1
        from public.receitas r
        join public.visionfood_order_ingredient_stock_ledger ingredient_ledger
          on ingredient_ledger.ingredient_id=coalesce(
            r.ingrediente_id,
            r.ingredient_id
          )
        where ingredient_ledger.order_id=o.id
          and ingredient_ledger.organization_id=o.organization_id
          and r.organization_id=o.organization_id
          and coalesce(r.product_id,r.produto_id)=p.id
      )
      or exists(
        select 1
        from public.visionfood_order_product_stock_ledger product_ledger
        where product_ledger.order_id=o.id
          and product_ledger.organization_id=o.organization_id
          and product_ledger.product_id=p.id
      )
    )
  order by p.id
  for update of p;

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
