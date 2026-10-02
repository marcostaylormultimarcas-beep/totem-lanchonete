-- VisionFood V2: recipe availability must not assume one kilogram for weighted products.
-- Additive migration only. Historical migrations remain untouched.
--
-- Contract:
-- - unit product: catalog availability still requires ingredient stock for one recipe unit;
-- - sold_by_weight product: catalog availability is blocked only when a required ingredient is exhausted;
-- - exact requested weight remains fail-closed and atomic in visionfood_consume_recipe_stock();
-- - rupture/minimum alerts remain driven by raw ingredient stock thresholds;
-- - changing sold_by_weight immediately resynchronizes recipe availability;
-- - manual available=true remains guarded by the same weighted-aware rule.

create or replace function public.visionfood_sync_product_recipe_availability(
  _organization_id uuid,
  _product_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_insufficient boolean;
  v_sold_by_weight boolean;
begin
  if _organization_id is null or _product_id is null then
    return;
  end if;

  select coalesce(p.sold_by_weight,false)
    into v_sold_by_weight
    from public.products p
   where p.id=_product_id
     and p.organization_id=_organization_id;

  if not found then
    return;
  end if;

  select exists(
    select 1
    from public.receitas r
    join public.ingredientes i
      on i.id=coalesce(r.ingrediente_id,r.ingredient_id)
     and i.organization_id=_organization_id
    where r.organization_id=_organization_id
      and coalesce(r.product_id,r.produto_id)=_product_id
      and greatest(coalesce(r.quantidade,0),0)>0
      and (
        (
          not v_sold_by_weight
          and coalesce(i.estoque_atual,0) < greatest(coalesce(r.quantidade,0),0)
        )
        or
        (
          v_sold_by_weight
          and coalesce(i.estoque_atual,0)<=0
        )
      )
  )
  into v_insufficient;

  if v_insufficient then
    update public.products p
       set ingredient_stock_blocked=case
             when p.available is true then true
             else p.ingredient_stock_blocked
           end,
           available=false,
           updated_at=now()
     where p.id=_product_id
       and p.organization_id=_organization_id;
  else
    update public.products p
       set available=true,
           ingredient_stock_blocked=false,
           updated_at=now()
     where p.id=_product_id
       and p.organization_id=_organization_id
       and p.ingredient_stock_blocked=true;
  end if;
end
$$;

revoke all on function public.visionfood_sync_product_recipe_availability(uuid,uuid)
  from public,anon,authenticated;


create or replace function public.visionfood_guard_product_recipe_availability()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_insufficient boolean;
begin
  if new.available is not true then
    return new;
  end if;

  select exists(
    select 1
    from public.receitas r
    join public.ingredientes i
      on i.id=coalesce(r.ingrediente_id,r.ingredient_id)
     and i.organization_id=new.organization_id
    where r.organization_id=new.organization_id
      and coalesce(r.product_id,r.produto_id)=new.id
      and greatest(coalesce(r.quantidade,0),0)>0
      and (
        (
          not coalesce(new.sold_by_weight,false)
          and coalesce(i.estoque_atual,0) < greatest(coalesce(r.quantidade,0),0)
        )
        or
        (
          coalesce(new.sold_by_weight,false)
          and coalesce(i.estoque_atual,0)<=0
        )
      )
  )
  into v_insufficient;

  if v_insufficient then
    new.available:=false;
    new.ingredient_stock_blocked:=true;
  end if;

  return new;
end
$$;

revoke all on function public.visionfood_guard_product_recipe_availability()
  from public,anon,authenticated;


create or replace function public.visionfood_sync_product_weight_availability_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.visionfood_sync_product_recipe_availability(
    new.organization_id,
    new.id
  );
  return new;
end
$$;

revoke all on function public.visionfood_sync_product_weight_availability_trigger()
  from public,anon,authenticated;

drop trigger if exists trg_visionfood_sync_product_weight_availability
  on public.products;

create trigger trg_visionfood_sync_product_weight_availability
after update of sold_by_weight on public.products
for each row execute function public.visionfood_sync_product_weight_availability_trigger();


-- Correct any stale ingredient_stock_blocked state created by the previous
-- one-recipe-unit availability rule. Manual unavailability is preserved because
-- the sync function only re-enables rows whose ingredient_stock_blocked=true.
do $$
declare
  x record;
begin
  for x in
    select p.id,p.organization_id
      from public.products p
     where exists(
       select 1
         from public.receitas r
        where r.organization_id=p.organization_id
          and coalesce(r.product_id,r.produto_id)=p.id
          and greatest(coalesce(r.quantidade,0),0)>0
     )
  loop
    perform public.visionfood_sync_product_recipe_availability(
      x.organization_id,
      x.id
    );
  end loop;
end
$$;
