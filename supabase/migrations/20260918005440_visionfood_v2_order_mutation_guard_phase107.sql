
create or replace function public.visionfood_guard_order_status_transition()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_allowed boolean:=false;
  v_age_seconds numeric;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status='cancelled' then
    if old.status not in ('pending','preparing','ready','out_for_delivery') then
      raise exception using
        errcode='23514',
        message='invalid_order_status_transition:'||coalesce(old.status,'null')||'->cancelled';
    end if;

    if new.status_reembolso is null or new.status_reembolso='none' then
      v_age_seconds:=extract(epoch from (now()-old.created_at));
      new.status_reembolso:=case
        when old.payment_status='paid'
             and (old.status='pending' or v_age_seconds<=300)
          then 'auto_eligible'
        when old.payment_status='paid'
          then 'manual_required'
        when old.payment_status is null
          then 'manual_required'
        else 'none'
      end;
    end if;

    return new;
  end if;

  v_allowed:=case
    when old.status='pending'
      then new.status='preparing'
    when old.status='preparing'
      then new.status='ready'
    when old.status='ready'
         and old.order_type in ('delivery','viagem')
      then new.status='out_for_delivery'
           and new.entregador_id is not null
    when old.status='ready'
         and old.order_type not in ('delivery','viagem')
      then new.status='delivered'
    when old.status='out_for_delivery'
         and old.order_type in ('delivery','viagem')
      then new.status='delivered'
           and new.entregador_id is not null
    else false
  end;

  if not v_allowed then
    raise exception using
      errcode='23514',
      message='invalid_order_status_transition:'||
              coalesce(old.status,'null')||'->'||coalesce(new.status,'null');
  end if;

  return new;
end
$$;

revoke all on function public.visionfood_guard_order_status_transition()
  from public,anon,authenticated;

drop trigger if exists trg_visionfood_guard_order_status_transition
  on public.orders;

create trigger trg_visionfood_guard_order_status_transition
before update of status on public.orders
for each row
execute function public.visionfood_guard_order_status_transition();

create or replace function public.visionfood_finalize_order_cancellation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_kind text;
  v_reason text;
  v_context_order text;
begin
  perform public.visionfood_restock_cancelled_order(new.id);
  perform public.visionfood_restock_recipe_stock(new.id);

  v_context_order:=current_setting('visionfood.cancel_order_id',true);

  if v_context_order=new.id::text then
    v_kind:=nullif(current_setting('visionfood.cancel_kind',true),'');
    v_reason:=coalesce(current_setting('visionfood.cancel_reason',true),'');
  else
    v_kind:=case
      when v_uid is not null
           and public.usuario_dono_org(new.organization_id,v_uid)
        then 'admin'
      when v_uid is not null and new.user_id=v_uid
        then 'customer'
      else 'system'
    end;
    v_reason:='cancelamento por atualização direta protegida';
  end if;

  if not exists(
    select 1
    from public.order_cancellations c
    where c.order_id=new.id
  ) then
    insert into public.order_cancellations(
      order_id,organization_id,cancelled_by,cancelled_by_kind,
      previous_status,reason
    )
    values(
      new.id,new.organization_id,v_uid,
      coalesce(v_kind,'system'),
      old.status,coalesce(v_reason,'')
    );
  end if;

  return new;
end
$$;

revoke all on function public.visionfood_finalize_order_cancellation()
  from public,anon,authenticated;

drop trigger if exists trg_visionfood_finalize_order_cancellation
  on public.orders;

create trigger trg_visionfood_finalize_order_cancellation
after update of status on public.orders
for each row
when (old.status is distinct from new.status and new.status='cancelled')
execute function public.visionfood_finalize_order_cancellation();

create or replace function public.cancelar_pedido(
  _order_id uuid,
  _motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  o public.orders%rowtype;
  after_o public.orders%rowtype;
  admin_ok boolean:=false;
  refund_status text:='none';
  age_seconds numeric;
  needs_stock_restock boolean:=false;
  needs_ingredient_restock boolean:=false;
  restocked boolean:=false;
  ingredient_restocked boolean:=false;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  select * into o
  from public.orders
  where id=_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','not_found');
  end if;

  admin_ok:=public.usuario_dono_org(o.organization_id,u);

  if not admin_ok then
    if o.user_id is null or o.user_id<>u then
      return jsonb_build_object('ok',false,'reason','forbidden');
    end if;
    if o.status<>'pending' then
      return jsonb_build_object('ok',false,'reason','status_locked');
    end if;
  end if;

  if o.status='cancelled' then
    return jsonb_build_object(
      'ok',true,'already_cancelled',true,
      'status_reembolso',o.status_reembolso
    );
  end if;

  if o.status='delivered' then
    return jsonb_build_object('ok',false,'reason','already_delivered');
  end if;

  if o.status in ('preparing','ready','out_for_delivery') then
    if not admin_ok then
      return jsonb_build_object('ok',false,'reason','admin_only');
    end if;
    if _motivo is null or length(btrim(_motivo))<3 then
      return jsonb_build_object('ok',false,'reason','reason_required');
    end if;
  end if;

  if o.status not in ('pending','preparing','ready','out_for_delivery') then
    return jsonb_build_object('ok',false,'reason','status_locked');
  end if;

  age_seconds:=extract(epoch from (now()-o.created_at));
  refund_status:=case
    when o.payment_status='paid'
         and (o.status='pending' or age_seconds<=300)
      then 'auto_eligible'
    when o.payment_status='paid'
      then 'manual_required'
    when o.payment_status is null
      then 'manual_required'
    else 'none'
  end;

  needs_stock_restock:=
    o.stock_committed_at is not null
    and o.stock_restocked_at is null;

  needs_ingredient_restock:=
    o.ingredient_stock_committed_at is not null
    and o.ingredient_stock_restocked_at is null;

  perform set_config('visionfood.cancel_order_id',o.id::text,true);
  perform set_config(
    'visionfood.cancel_reason',
    coalesce(btrim(_motivo),''),
    true
  );
  perform set_config(
    'visionfood.cancel_kind',
    case when admin_ok then 'admin' else 'customer' end,
    true
  );

  update public.orders
     set status='cancelled',
         status_reembolso=refund_status,
         updated_at=now()
   where id=o.id;

  select * into after_o
  from public.orders
  where id=o.id;

  restocked:=
    needs_stock_restock
    and after_o.stock_restocked_at is not null;

  ingredient_restocked:=
    needs_ingredient_restock
    and after_o.ingredient_stock_restocked_at is not null;

  return jsonb_build_object(
    'ok',true,
    'order_id',o.id,
    'previous_status',o.status,
    'payment_status',o.payment_status,
    'status_reembolso',after_o.status_reembolso,
    'stock_restocked',restocked,
    'ingredient_stock_restocked',ingredient_restocked
  );
end
$$;

revoke all on function public.cancelar_pedido(uuid,text)
  from public,anon;
grant execute on function public.cancelar_pedido(uuid,text)
  to authenticated;

revoke delete,truncate,references,trigger
  on table public.orders
  from anon,authenticated;
