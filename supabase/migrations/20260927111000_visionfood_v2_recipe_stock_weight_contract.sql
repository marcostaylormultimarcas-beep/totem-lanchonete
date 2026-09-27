-- VisionFood V2: ingredient recipe stock must use the authoritative sold weight.
-- Additive migration only. Historical migrations remain untouched.
--
-- Contract:
-- - unit product: recipe multiplier = quantity;
-- - sold_by_weight product: recipe multiplier = weight_kg;
-- - weighted items without a positive weight fail closed;
-- - cancellation/restock mirrors the exact same multiplier;
-- - existing stock alerts, ingredient availability triggers and idempotency markers remain intact.

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
  rec record;
  needed numeric;
  new_stock numeric;
begin
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

    for rec in
      select
        i.id ingrediente_id,
        i.nome,
        i.estoque_atual,
        coalesce(i.estoque_minimo,0) estoque_minimo,
        r.quantidade
      from public.receitas r
      join public.ingredientes i
        on i.id=coalesce(r.ingrediente_id,r.ingredient_id)
      where coalesce(r.product_id,r.produto_id)=pid
        and r.organization_id=new.organization_id
      for update of i
    loop
      needed:=greatest(coalesce(rec.quantidade,0),0)*multiplier;

      if needed<=0 then
        continue;
      end if;

      if coalesce(rec.estoque_atual,0)<needed then
        raise exception 'insufficient ingredient stock: %',rec.nome;
      end if;

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
            new.organization_id,rec.ingrediente_id,pid,'ruptura',
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
            new.organization_id,rec.ingrediente_id,pid,'minimo',
            'Ingrediente "'||rec.nome||'" atingiu o estoque mínimo.'
          );
        end if;
      end if;
    end loop;
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
  item jsonb;
  pid uuid;
  qty numeric;
  weight numeric;
  is_by_weight boolean;
  multiplier numeric;
  rec record;
  amount numeric;
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

  if o.items is not null and jsonb_typeof(o.items)='array' then
    for item in select value from jsonb_array_elements(o.items)
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
         and p.organization_id=o.organization_id;

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

      for rec in
        select
          i.id as ingrediente_id,
          r.quantidade
        from public.receitas r
        join public.ingredientes i
          on i.id=coalesce(r.ingrediente_id,r.ingredient_id)
        where coalesce(r.product_id,r.produto_id)=pid
          and r.organization_id=o.organization_id
        for update of i
      loop
        amount:=greatest(coalesce(rec.quantidade,0),0)*multiplier;

        if amount>0 then
          update public.ingredientes
             set estoque_atual=estoque_atual+amount,
                 disponivel=true,
                 updated_at=now()
           where id=rec.ingrediente_id;
        end if;
      end loop;
    end loop;
  end if;

  update public.orders
     set ingredient_stock_restocked_at=now()
   where id=o.id;

  return true;
end
$$;

revoke all on function public.visionfood_restock_recipe_stock(uuid)
  from public,anon,authenticated;
