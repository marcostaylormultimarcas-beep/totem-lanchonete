create table if not exists public.alertas_estoque (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ingrediente_id uuid references public.ingredientes(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  tipo text not null default 'ruptura',
  mensagem text not null default '',
  webhook_status text not null default 'pending',
  webhook_error text not null default '',
  resolvido boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_alertas_estoque_org_created on public.alertas_estoque(organization_id,created_at desc);

alter table public.alertas_estoque enable row level security;
drop policy if exists alertas_estoque_owner_select on public.alertas_estoque;
drop policy if exists alertas_estoque_owner_update on public.alertas_estoque;
create policy alertas_estoque_owner_select on public.alertas_estoque
for select to authenticated
using(public.usuario_dono_org(organization_id,(select auth.uid())));
create policy alertas_estoque_owner_update on public.alertas_estoque
for update to authenticated
using(public.usuario_dono_org(organization_id,(select auth.uid())))
with check(public.usuario_dono_org(organization_id,(select auth.uid())));
revoke all on table public.alertas_estoque from public,anon,authenticated;
grant select,update on table public.alertas_estoque to authenticated;
grant all on table public.alertas_estoque to service_role;

revoke all on table public.ingredientes from anon;
revoke all on table public.receitas from anon;

alter table public.products
  add column if not exists ingredient_stock_blocked boolean not null default false;

alter table public.orders
  add column if not exists ingredient_stock_committed_at timestamptz,
  add column if not exists ingredient_stock_restocked_at timestamptz;

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
    exception when invalid_text_representation then
      raise exception 'invalid ingredient stock item';
    end;

    if pid is null or qty<=0 then continue; end if;

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
      needed:=greatest(coalesce(rec.quantidade,0),0)*qty;
      if needed<=0 then continue; end if;

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
           set ingredient_stock_blocked=case when p.available then true else p.ingredient_stock_blocked end,
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
          insert into public.alertas_estoque(organization_id,ingrediente_id,product_id,tipo,mensagem)
          values(new.organization_id,rec.ingrediente_id,pid,'ruptura',
            'Ingrediente "'||rec.nome||'" esgotado. Produtos relacionados foram bloqueados.');
        end if;
      elsif new_stock<=rec.estoque_minimo then
        if not exists(
          select 1 from public.alertas_estoque a
          where a.organization_id=new.organization_id
            and a.ingrediente_id=rec.ingrediente_id
            and a.resolvido=false
            and a.tipo='minimo'
        ) then
          insert into public.alertas_estoque(organization_id,ingrediente_id,product_id,tipo,mensagem)
          values(new.organization_id,rec.ingrediente_id,pid,'minimo',
            'Ingrediente "'||rec.nome||'" atingiu o estoque mínimo.');
        end if;
      end if;
    end loop;
  end loop;

  new.ingredient_stock_committed_at:=now();
  return new;
end$$;
revoke all on function public.visionfood_consume_recipe_stock() from public,anon,authenticated;

drop trigger if exists trg_consumir_estoque_from_order on public.orders;
drop trigger if exists trg_visionfood_consume_recipe_stock on public.orders;
create trigger trg_visionfood_consume_recipe_stock
before insert on public.orders
for each row execute function public.visionfood_consume_recipe_stock();

create or replace function public.reabastecer_ingrediente(_id uuid,_quantidade numeric)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  ing public.ingredientes%rowtype;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  if _quantidade is null or _quantidade<=0 or _quantidade>1000000 then
    return jsonb_build_object('ok',false,'reason','invalid_quantity');
  end if;

  select * into ing from public.ingredientes where id=_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if not public.usuario_dono_org(ing.organization_id,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  update public.ingredientes
     set estoque_atual=estoque_atual+_quantidade,
         disponivel=(estoque_atual+_quantidade)>0,
         updated_at=now()
   where id=_id;

  update public.products p
     set available=true,
         ingredient_stock_blocked=false,
         updated_at=now()
   where p.organization_id=ing.organization_id
     and p.ingredient_stock_blocked=true
     and p.id in (
       select coalesce(r.product_id,r.produto_id)
       from public.receitas r
       where coalesce(r.ingrediente_id,r.ingredient_id)=_id
     )
     and not exists(
       select 1
       from public.receitas r2
       join public.ingredientes i2 on i2.id=coalesce(r2.ingrediente_id,r2.ingredient_id)
       where coalesce(r2.product_id,r2.produto_id)=p.id
         and i2.estoque_atual<=0
     );

  update public.alertas_estoque
     set resolvido=true
   where organization_id=ing.organization_id
     and ingrediente_id=_id
     and resolvido=false;

  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.reabastecer_ingrediente(uuid,numeric) from public,anon;
grant execute on function public.reabastecer_ingrediente(uuid,numeric) to authenticated;

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
  select * into o from public.orders where id=_order_id for update;
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
      if pid is null or qty<=0 then continue; end if;

      for rec in
        select i.id ingrediente_id,r.quantidade
        from public.receitas r
        join public.ingredientes i on i.id=coalesce(r.ingrediente_id,r.ingredient_id)
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

          update public.alertas_estoque
             set resolvido=true
           where organization_id=o.organization_id
             and ingrediente_id=rec.ingrediente_id
             and resolvido=false;
        end if;
      end loop;
    end loop;
  end if;

  update public.products p
     set available=true,
         ingredient_stock_blocked=false,
         updated_at=now()
   where p.organization_id=o.organization_id
     and p.ingredient_stock_blocked=true
     and not exists(
       select 1
       from public.receitas r
       join public.ingredientes i on i.id=coalesce(r.ingrediente_id,r.ingredient_id)
       where coalesce(r.product_id,r.produto_id)=p.id
         and i.estoque_atual<=0
     );

  update public.orders set ingredient_stock_restocked_at=now() where id=o.id;
  return true;
end$$;
revoke all on function public.visionfood_restock_recipe_stock(uuid) from public,anon,authenticated;

create or replace function public.cancelar_pedido(_order_id uuid,_motivo text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  o public.orders%rowtype;
  admin_ok boolean:=false;
  refund_status text:='none';
  age_seconds numeric;
  restocked boolean:=false;
  ingredient_restocked boolean:=false;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select * into o from public.orders where id=_order_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;

  admin_ok:=public.usuario_dono_org(o.organization_id,u);
  if not admin_ok then
    if o.user_id is null or o.user_id<>u then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
    if o.status<>'pending' then return jsonb_build_object('ok',false,'reason','status_locked'); end if;
  end if;

  if o.status='cancelled' then
    return jsonb_build_object('ok',true,'already_cancelled',true,'status_reembolso',o.status_reembolso);
  end if;
  if o.status='delivered' then return jsonb_build_object('ok',false,'reason','already_delivered'); end if;

  if o.status in ('preparing','ready','out_for_delivery') then
    if not admin_ok then return jsonb_build_object('ok',false,'reason','admin_only'); end if;
    if _motivo is null or length(btrim(_motivo))<3 then return jsonb_build_object('ok',false,'reason','reason_required'); end if;
  end if;

  if o.status not in ('pending','preparing','ready','out_for_delivery') then
    return jsonb_build_object('ok',false,'reason','status_locked');
  end if;

  age_seconds:=extract(epoch from (now()-o.created_at));
  refund_status:=case
    when o.payment_status='paid' and (o.status='pending' or age_seconds<=300) then 'auto_eligible'
    when o.payment_status='paid' then 'manual_required'
    when o.payment_status is null then 'manual_required'
    else 'none'
  end;

  update public.orders set status='cancelled',status_reembolso=refund_status,updated_at=now() where id=o.id;
  restocked:=public.visionfood_restock_cancelled_order(o.id);
  ingredient_restocked:=public.visionfood_restock_recipe_stock(o.id);

  insert into public.order_cancellations(order_id,organization_id,cancelled_by,cancelled_by_kind,previous_status,reason)
  values(o.id,o.organization_id,u,case when admin_ok then 'admin' else 'customer' end,o.status,coalesce(btrim(_motivo),''));

  return jsonb_build_object(
    'ok',true,'order_id',o.id,'previous_status',o.status,
    'payment_status',o.payment_status,'status_reembolso',refund_status,
    'stock_restocked',restocked,'ingredient_stock_restocked',ingredient_restocked
  );
end$$;
revoke all on function public.cancelar_pedido(uuid,text) from public,anon;
grant execute on function public.cancelar_pedido(uuid,text) to authenticated;