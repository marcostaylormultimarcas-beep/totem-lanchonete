
create index if not exists idx_alertas_estoque_ingrediente
  on public.alertas_estoque(ingrediente_id);

create index if not exists idx_alertas_estoque_product
  on public.alertas_estoque(product_id);

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
begin
  if _organization_id is null or _product_id is null then
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
      and coalesce(i.estoque_atual,0) < greatest(coalesce(r.quantidade,0),0)
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

create or replace function public.visionfood_sync_ingredient_state(
  _organization_id uuid,
  _ingredient_id uuid,
  _source_product_id uuid default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  ing record;
  v_product_id uuid;
  v_has_recipe boolean;
begin
  if _organization_id is null or _ingredient_id is null then
    return;
  end if;

  select
    i.id,
    i.nome,
    coalesce(i.estoque_atual,0) as estoque_atual,
    coalesce(i.estoque_minimo,0) as estoque_minimo
  into ing
  from public.ingredientes i
  where i.id=_ingredient_id
    and i.organization_id=_organization_id;

  if not found then
    return;
  end if;

  for v_product_id in
    select distinct coalesce(r.product_id,r.produto_id)
    from public.receitas r
    where r.organization_id=_organization_id
      and coalesce(r.ingrediente_id,r.ingredient_id)=_ingredient_id
      and coalesce(r.product_id,r.produto_id) is not null
  loop
    perform public.visionfood_sync_product_recipe_availability(
      _organization_id,
      v_product_id
    );
  end loop;

  select exists(
    select 1
    from public.receitas r
    where r.organization_id=_organization_id
      and coalesce(r.ingrediente_id,r.ingredient_id)=_ingredient_id
      and coalesce(r.product_id,r.produto_id) is not null
      and greatest(coalesce(r.quantidade,0),0)>0
  )
  into v_has_recipe;

  if not v_has_recipe then
    update public.alertas_estoque
       set resolvido=true
     where organization_id=_organization_id
       and ingrediente_id=_ingredient_id
       and resolvido=false
       and tipo in ('ruptura','minimo');
    return;
  end if;

  if ing.estoque_atual<=0 then
    update public.alertas_estoque
       set resolvido=true
     where organization_id=_organization_id
       and ingrediente_id=_ingredient_id
       and resolvido=false
       and tipo='minimo';

    if not exists(
      select 1
      from public.alertas_estoque a
      where a.organization_id=_organization_id
        and a.ingrediente_id=_ingredient_id
        and a.resolvido=false
        and a.tipo='ruptura'
    ) then
      insert into public.alertas_estoque(
        organization_id,ingrediente_id,product_id,tipo,mensagem
      )
      values(
        _organization_id,_ingredient_id,_source_product_id,'ruptura',
        'Ingrediente "'||ing.nome||'" esgotado. Produtos relacionados foram bloqueados.'
      );
    end if;

  elsif ing.estoque_atual<=ing.estoque_minimo then
    update public.alertas_estoque
       set resolvido=true
     where organization_id=_organization_id
       and ingrediente_id=_ingredient_id
       and resolvido=false
       and tipo='ruptura';

    if not exists(
      select 1
      from public.alertas_estoque a
      where a.organization_id=_organization_id
        and a.ingrediente_id=_ingredient_id
        and a.resolvido=false
        and a.tipo='minimo'
    ) then
      insert into public.alertas_estoque(
        organization_id,ingrediente_id,product_id,tipo,mensagem
      )
      values(
        _organization_id,_ingredient_id,_source_product_id,'minimo',
        'Ingrediente "'||ing.nome||'" atingiu o estoque mínimo.'
      );
    end if;

  else
    update public.alertas_estoque
       set resolvido=true
     where organization_id=_organization_id
       and ingrediente_id=_ingredient_id
       and resolvido=false
       and tipo in ('ruptura','minimo');
  end if;
end
$$;

revoke all on function public.visionfood_sync_ingredient_state(uuid,uuid,uuid)
  from public,anon,authenticated;

create or replace function public.visionfood_sync_ingredient_state_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.visionfood_sync_ingredient_state(
    new.organization_id,
    new.id,
    null
  );
  return new;
end
$$;

revoke all on function public.visionfood_sync_ingredient_state_trigger()
  from public,anon,authenticated;

drop trigger if exists trg_visionfood_sync_ingredient_state on public.ingredientes;
create trigger trg_visionfood_sync_ingredient_state
after insert or update of estoque_atual,estoque_minimo on public.ingredientes
for each row execute function public.visionfood_sync_ingredient_state_trigger();

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

    if old_product is not null then
      perform public.visionfood_sync_product_recipe_availability(old_org,old_product);
    end if;
    if old_ingredient is not null then
      perform public.visionfood_sync_ingredient_state(old_org,old_ingredient,old_product);
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    new_org:=new.organization_id;
    new_product:=coalesce(new.product_id,new.produto_id);
    new_ingredient:=coalesce(new.ingrediente_id,new.ingredient_id);

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

drop trigger if exists trg_visionfood_sync_recipe_state on public.receitas;
create trigger trg_visionfood_sync_recipe_state
after insert or update or delete on public.receitas
for each row execute function public.visionfood_sync_recipe_state_trigger();

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
      and coalesce(i.estoque_atual,0) < greatest(coalesce(r.quantidade,0),0)
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

drop trigger if exists trg_visionfood_guard_product_recipe_availability
  on public.products;

create trigger trg_visionfood_guard_product_recipe_availability
before update of available on public.products
for each row execute function public.visionfood_guard_product_recipe_availability();

create or replace function public.reabastecer_ingrediente(_id uuid,_quantidade numeric)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  ing public.ingredientes%rowtype;
  v_new_stock numeric;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  if _quantidade is null or _quantidade<=0 or _quantidade>1000000 then
    return jsonb_build_object('ok',false,'reason','invalid_quantity');
  end if;

  select * into ing
  from public.ingredientes
  where id=_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','not_found');
  end if;

  if not public.usuario_dono_org(ing.organization_id,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  v_new_stock:=coalesce(ing.estoque_atual,0)+_quantidade;

  update public.ingredientes
     set estoque_atual=v_new_stock,
         disponivel=(v_new_stock>0),
         updated_at=now()
   where id=_id;

  return jsonb_build_object(
    'ok',true,
    'estoque_atual',v_new_stock
  );
end
$$;

revoke all on function public.reabastecer_ingrediente(uuid,numeric)
  from public,anon;
grant execute on function public.reabastecer_ingrediente(uuid,numeric)
  to authenticated;

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
      exception when invalid_text_representation then
        continue;
      end;

      if pid is null or qty<=0 then
        continue;
      end if;

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
        amount:=greatest(coalesce(rec.quantidade,0),0)*qty;

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

revoke all on table public.ingredientes from authenticated;
grant select,insert,update,delete on table public.ingredientes to authenticated;

revoke all on table public.receitas from authenticated;
grant select,insert,update,delete on table public.receitas to authenticated;

do $$
declare
  x record;
begin
  for x in
    select id,organization_id
    from public.ingredientes
  loop
    perform public.visionfood_sync_ingredient_state(
      x.organization_id,
      x.id,
      null
    );
  end loop;
end
$$;
