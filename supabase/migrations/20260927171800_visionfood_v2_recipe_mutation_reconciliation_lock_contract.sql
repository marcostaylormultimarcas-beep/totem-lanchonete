-- VisionFood V2: reconcile recipe mutations immediately without crossing the
-- global ingredient -> product lock hierarchy.
-- Additive migration only. Historical migrations remain untouched.
--
-- Functional behavior intentionally remains the same:
-- - INSERT reconciles NEW product/ingredient;
-- - UPDATE reconciles OLD and NEW sides;
-- - DELETE reconciles OLD product/ingredient;
-- - quantity-only updates still fire because the table trigger covers every UPDATE.
--
-- Concurrency contract:
-- 1. prelock OLD/NEW ingredient rows in deterministic UUID order;
-- 2. while those ingredient locks prevent the current recipe graph for the same
--    ingredients from changing concurrently, prelock the complete product union
--    that OLD/NEW reconciliation can touch, also in deterministic UUID order;
-- 3. only then run the existing product/ingredient synchronization calls.
--
-- This keeps recipe edits compatible with checkout/restock's established
-- ingredient -> product lock order and avoids OLD/NEW crossed product deadlocks.

create or replace function public.visionfood_sync_recipe_state_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  old_org uuid;
  old_product uuid;
  old_ingredient uuid;
  new_org uuid;
  new_product uuid;
  new_ingredient uuid;
begin
  if tg_op in ('UPDATE','DELETE') then
    old_org:=old.organization_id;
    old_product:=coalesce(old.product_id,old.produto_id);
    old_ingredient:=coalesce(old.ingrediente_id,old.ingredient_id);
  end if;

  if tg_op in ('INSERT','UPDATE') then
    new_org:=new.organization_id;
    new_product:=coalesce(new.product_id,new.produto_id);
    new_ingredient:=coalesce(new.ingrediente_id,new.ingredient_id);
  end if;

  -- Keep recipe mutations inside the same global hierarchy used by checkout
  -- and cancellation: ingredient rows first, always in UUID order.
  perform i.id
  from public.ingredientes i
  where (
      old_org is not null
      and old_ingredient is not null
      and i.organization_id=old_org
      and i.id=old_ingredient
    )
    or (
      new_org is not null
      and new_ingredient is not null
      and i.organization_id=new_org
      and i.id=new_ingredient
    )
  order by i.id
  for update of i;

  -- Prelock every product that the OLD/NEW reconciliation can touch.
  -- Explicit OLD/NEW products cover relations removed by the triggering row;
  -- current recipe lookups cover all products still related to either
  -- ingredient. Holding the ingredient rows above prevents a concurrent recipe
  -- mutation for the same ingredient from changing this lock set between this
  -- prelock and visionfood_sync_ingredient_state().
  perform p.id
  from public.products p
  where (
      old_org is not null
      and p.organization_id=old_org
      and (
        (old_product is not null and p.id=old_product)
        or (
          old_ingredient is not null
          and exists(
            select 1
            from public.receitas r
            where r.organization_id=old_org
              and coalesce(r.ingrediente_id,r.ingredient_id)=old_ingredient
              and coalesce(r.product_id,r.produto_id)=p.id
          )
        )
      )
    )
    or (
      new_org is not null
      and p.organization_id=new_org
      and (
        (new_product is not null and p.id=new_product)
        or (
          new_ingredient is not null
          and exists(
            select 1
            from public.receitas r
            where r.organization_id=new_org
              and coalesce(r.ingrediente_id,r.ingredient_id)=new_ingredient
              and coalesce(r.product_id,r.produto_id)=p.id
          )
        )
      )
    )
  order by p.id
  for update of p;

  if tg_op in ('UPDATE','DELETE') then
    if old_product is not null then
      perform public.visionfood_sync_product_recipe_availability(old_org,old_product);
    end if;
    if old_ingredient is not null then
      perform public.visionfood_sync_ingredient_state(old_org,old_ingredient,old_product);
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    if new_product is not null then
      perform public.visionfood_sync_product_recipe_availability(new_org,new_product);
    end if;
    if new_ingredient is not null then
      perform public.visionfood_sync_ingredient_state(new_org,new_ingredient,new_product);
    end if;
  end if;

  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke all on function public.visionfood_sync_recipe_state_trigger()
  from public,anon,authenticated;
