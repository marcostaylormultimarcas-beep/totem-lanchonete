-- Phase 95: stock lifecycle markers + idempotent cancellation/restock.
alter table public.orders
  add column if not exists stock_committed_at timestamptz,
  add column if not exists stock_restocked_at timestamptz,
  add column if not exists status_reembolso text not null default 'none',
  add column if not exists data_reembolso timestamptz;

create table if not exists public.order_cancellations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cancelled_by uuid,
  cancelled_by_kind text not null,
  previous_status text not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_order_cancellations_org on public.order_cancellations(organization_id,created_at desc);
create index if not exists idx_order_cancellations_order on public.order_cancellations(order_id);

alter table public.order_cancellations enable row level security;
drop policy if exists order_cancellations_read_authorized on public.order_cancellations;
create policy order_cancellations_read_authorized
on public.order_cancellations for select to authenticated
using (
  cancelled_by=(select auth.uid())
  or public.usuario_dono_org(organization_id,(select auth.uid()))
);
revoke all on table public.order_cancellations from public,anon,authenticated;
grant select on table public.order_cancellations to authenticated;
grant all on table public.order_cancellations to service_role;

create or replace function public.visionfood_decrement_stock_from_order()
returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb; pid uuid; qty numeric; weight numeric; amount numeric; p public.products%rowtype;
begin
  if new.items is null or jsonb_typeof(new.items)<>'array' then
    new.stock_committed_at:=now();
    return new;
  end if;
  for item in select value from jsonb_array_elements(new.items) loop
    begin
      pid:=coalesce(nullif(item->>'product_id','')::uuid,nullif(item->>'id','')::uuid,nullif(item#>>'{product,id}','')::uuid);
      qty:=coalesce(nullif(item->>'quantity','')::numeric,1);
      weight:=nullif(item->>'weight_kg','')::numeric;
    exception when invalid_text_representation then raise exception 'invalid stock item'; end;
    if pid is null then continue; end if;
    select * into p from public.products where id=pid and organization_id=new.organization_id for update;
    if not found or coalesce(p.manage_stock,false) is not true then continue; end if;
    amount:=case when coalesce(p.sold_by_weight,false) and weight is not null then weight else qty end;
    if amount is null or amount<=0 then raise exception 'invalid stock quantity for product %',pid; end if;
    if coalesce(p.stock_quantity,0)<amount then raise exception 'insufficient stock for product %',pid; end if;
    update public.products set stock_quantity=stock_quantity-amount,updated_at=now() where id=pid;
  end loop;
  new.stock_committed_at:=now();
  return new;
end$$;
revoke all on function public.visionfood_decrement_stock_from_order() from public,anon,authenticated;

drop trigger if exists trg_visionfood_decrement_stock_on_order on public.orders;
create trigger trg_visionfood_decrement_stock_on_order
before insert on public.orders
for each row execute function public.visionfood_decrement_stock_from_order();

create or replace function public.visionfood_restock_cancelled_order(_order_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; item jsonb; pid uuid; qty numeric; weight numeric; amount numeric; p public.products%rowtype;
begin
  select * into o from public.orders where id=_order_id for update;
  if not found or o.stock_committed_at is null or o.stock_restocked_at is not null then return false; end if;
  if o.items is not null and jsonb_typeof(o.items)='array' then
    for item in select value from jsonb_array_elements(o.items) loop
      begin
        pid:=coalesce(nullif(item->>'product_id','')::uuid,nullif(item->>'id','')::uuid,nullif(item#>>'{product,id}','')::uuid);
        qty:=coalesce(nullif(item->>'quantity','')::numeric,1);
        weight:=nullif(item->>'weight_kg','')::numeric;
      exception when invalid_text_representation then continue; end;
      if pid is null then continue; end if;
      select * into p from public.products where id=pid and organization_id=o.organization_id for update;
      if not found or coalesce(p.manage_stock,false) is not true then continue; end if;
      amount:=case when coalesce(p.sold_by_weight,false) and weight is not null then weight else qty end;
      if amount is not null and amount>0 then
        update public.products set stock_quantity=stock_quantity+amount,updated_at=now() where id=pid;
      end if;
    end loop;
  end if;
  update public.orders set stock_restocked_at=now() where id=o.id;
  return true;
end$$;
revoke all on function public.visionfood_restock_cancelled_order(uuid) from public,anon,authenticated;

create or replace function public.cancelar_pedido(_order_id uuid,_motivo text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.orders%rowtype; admin_ok boolean:=false; refund_status text:='none'; age_seconds numeric; restocked boolean:=false;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select * into o from public.orders where id=_order_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  admin_ok:=public.usuario_dono_org(o.organization_id,u);
  if not admin_ok then
    if o.user_id is null or o.user_id<>u then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
    if o.status<>'pending' then return jsonb_build_object('ok',false,'reason','status_locked'); end if;
  end if;
  if o.status='cancelled' then return jsonb_build_object('ok',true,'already_cancelled',true,'status_reembolso',o.status_reembolso); end if;
  if o.status='delivered' then return jsonb_build_object('ok',false,'reason','already_delivered'); end if;
  if o.status in ('preparing','ready','out_for_delivery') then
    if not admin_ok then return jsonb_build_object('ok',false,'reason','admin_only'); end if;
    if _motivo is null or length(btrim(_motivo))<3 then return jsonb_build_object('ok',false,'reason','reason_required'); end if;
  end if;
  if o.status not in ('pending','preparing','ready','out_for_delivery') then
    return jsonb_build_object('ok',false,'reason','status_locked');
  end if;
  age_seconds:=extract(epoch from (now()-o.created_at));
  refund_status:=case when o.status='pending' or age_seconds<=300 then 'auto_eligible' else 'manual_required' end;
  update public.orders set status='cancelled',status_reembolso=refund_status,updated_at=now() where id=o.id;
  restocked:=public.visionfood_restock_cancelled_order(o.id);
  insert into public.order_cancellations(order_id,organization_id,cancelled_by,cancelled_by_kind,previous_status,reason)
  values(o.id,o.organization_id,u,case when admin_ok then 'admin' else 'customer' end,o.status,coalesce(btrim(_motivo),''));
  return jsonb_build_object('ok',true,'order_id',o.id,'previous_status',o.status,'status_reembolso',refund_status,'stock_restocked',restocked);
end$$;
revoke all on function public.cancelar_pedido(uuid,text) from public,anon;
grant execute on function public.cancelar_pedido(uuid,text) to authenticated;
