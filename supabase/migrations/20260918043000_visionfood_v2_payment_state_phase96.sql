-- Phase 96: explicit payment state for new orders + secure admin confirmation.
alter table public.orders
  add column if not exists payment_status text,
  add column if not exists payment_confirmed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.orders'::regclass
      and conname='orders_payment_status_check'
  ) then
    alter table public.orders
      add constraint orders_payment_status_check
      check (payment_status is null or payment_status in ('pending','paid','failed','refunded'));
  end if;
end$$;

create or replace function public.visionfood_set_initial_payment_status()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.payment_status is not null then return new; end if;
  if new.order_type='pdv' then
    new.payment_status:='paid';
    new.payment_confirmed_at:=coalesce(new.payment_confirmed_at,now());
  else
    new.payment_status:='pending';
  end if;
  return new;
end$$;
revoke all on function public.visionfood_set_initial_payment_status() from public,anon,authenticated;

drop trigger if exists trg_visionfood_initial_payment_status on public.orders;
create trigger trg_visionfood_initial_payment_status
before insert on public.orders
for each row execute function public.visionfood_set_initial_payment_status();

create or replace function public.confirm_order_payment(_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.orders%rowtype;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select * into o from public.orders where id=_order_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if not public.usuario_dono_org(o.organization_id,u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if o.status='cancelled' then return jsonb_build_object('ok',false,'reason','order_cancelled'); end if;
  if o.payment_status='paid' then
    return jsonb_build_object('ok',true,'already_paid',true,'payment_confirmed_at',o.payment_confirmed_at);
  end if;
  if o.payment_status in ('failed','refunded') then
    return jsonb_build_object('ok',false,'reason','payment_status_locked');
  end if;
  update public.orders
     set payment_status='paid',
         payment_confirmed_at=coalesce(payment_confirmed_at,now()),
         updated_at=now()
   where id=o.id;
  return jsonb_build_object('ok',true,'order_id',o.id,'payment_status','paid');
end$$;
revoke all on function public.confirm_order_payment(uuid) from public,anon;
grant execute on function public.confirm_order_payment(uuid) to authenticated;

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
  refund_status:=case
    when o.payment_status='paid' and (o.status='pending' or age_seconds<=300) then 'auto_eligible'
    when o.payment_status='paid' then 'manual_required'
    when o.payment_status is null then 'manual_required'
    else 'none'
  end;

  update public.orders set status='cancelled',status_reembolso=refund_status,updated_at=now() where id=o.id;
  restocked:=public.visionfood_restock_cancelled_order(o.id);

  insert into public.order_cancellations(order_id,organization_id,cancelled_by,cancelled_by_kind,previous_status,reason)
  values(o.id,o.organization_id,u,case when admin_ok then 'admin' else 'customer' end,o.status,coalesce(btrim(_motivo),''));

  return jsonb_build_object(
    'ok',true,
    'order_id',o.id,
    'previous_status',o.status,
    'payment_status',o.payment_status,
    'status_reembolso',refund_status,
    'stock_restocked',restocked
  );
end$$;
revoke all on function public.cancelar_pedido(uuid,text) from public,anon;
grant execute on function public.cancelar_pedido(uuid,text) to authenticated;
