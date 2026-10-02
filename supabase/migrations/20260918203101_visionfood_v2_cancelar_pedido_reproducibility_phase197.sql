-- Phase 197 — reassert cancelar_pedido after historical migration-order drift.
-- The official database applied phase95 before phase107, but the repository's
-- phase95 filename sorts after phase107. Recreate the authoritative final RPC
-- here so fresh migration replay ends with the same secure definition.

do $$
begin
  if to_regprocedure('public.cancelar_pedido(uuid,text)') is null then
    raise exception 'public.cancelar_pedido(uuid,text) not found';
  end if;
  if to_regprocedure('private.usuario_dono_org(uuid,uuid)') is null then
    raise exception 'private.usuario_dono_org(uuid,uuid) not found';
  end if;
end
$$;

create or replace function public.cancelar_pedido(
  _order_id uuid,
  _motivo text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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

  admin_ok:=private.usuario_dono_org(o.organization_id,u);

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
$function$;

revoke all on function public.cancelar_pedido(uuid,text)
from public, anon, authenticated, service_role;

grant execute on function public.cancelar_pedido(uuid,text)
to authenticated, service_role;

do $$
declare
  v_oid oid := 'public.cancelar_pedido(uuid,text)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
begin
  if not (select prosecdef from pg_proc where oid=v_oid) then
    raise exception 'cancelar_pedido must remain SECURITY DEFINER';
  end if;

  if not (
    select proconfig @> array['search_path=""']::text[]
    from pg_proc
    where oid=v_oid
  ) then
    raise exception 'cancelar_pedido must keep empty search_path';
  end if;

  if position('private.usuario_dono_org(o.organization_id,u)' in v_def)=0 then
    raise exception 'cancelar_pedido must authorize against order organization';
  end if;

  if position('o.user_id is null or o.user_id<>u' in v_def)=0 then
    raise exception 'cancelar_pedido customer ownership guard missing';
  end if;

  if has_function_privilege('anon',v_oid,'EXECUTE') then
    raise exception 'anon execute must remain revoked';
  end if;

  if not has_function_privilege('authenticated',v_oid,'EXECUTE') then
    raise exception 'authenticated execute must remain granted';
  end if;
end
$$;
