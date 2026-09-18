
create or replace function public.visionfood_update_order_status(
  _order_id uuid,
  _expected_status text,
  _next_status text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  o public.orders%rowtype;
  v_allowed boolean:=false;
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

  if not public.usuario_dono_org(o.organization_id,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if _expected_status is null or o.status is distinct from _expected_status then
    return jsonb_build_object(
      'ok',false,'reason','status_changed',
      'current_status',o.status
    );
  end if;

  if _next_status is null or _next_status=_expected_status then
    return jsonb_build_object('ok',false,'reason','invalid_transition');
  end if;

  if o.status='ready'
     and o.order_type in ('delivery','viagem')
     and _next_status='out_for_delivery'
     and o.entregador_id is null then
    return jsonb_build_object('ok',false,'reason','driver_required');
  end if;

  v_allowed:=case
    when o.status='pending' then _next_status='preparing'
    when o.status='preparing' then _next_status='ready'
    when o.status='ready' and o.order_type in ('delivery','viagem')
      then _next_status='out_for_delivery'
    when o.status='ready' and o.order_type not in ('delivery','viagem')
      then _next_status='delivered'
    when o.status='out_for_delivery' and o.order_type in ('delivery','viagem')
      then _next_status='delivered'
    else false
  end;

  if not v_allowed then
    return jsonb_build_object(
      'ok',false,'reason','invalid_transition',
      'current_status',o.status,
      'requested_status',_next_status
    );
  end if;

  update public.orders
     set status=_next_status,
         updated_at=now()
   where id=o.id;

  return jsonb_build_object(
    'ok',true,
    'order_id',o.id,
    'previous_status',o.status,
    'status',_next_status
  );
end
$$;

revoke all on function public.visionfood_update_order_status(uuid,text,text)
  from public,anon;
grant execute on function public.visionfood_update_order_status(uuid,text,text)
  to authenticated;

create or replace function public.confirm_delivery_with_code_session(
  _session_token text,
  _order_id uuid,
  _code text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_e public.entregadores%rowtype;
  v_order public.orders%rowtype;
begin
  v_e:=public.entregador_session_driver(_session_token);
  if v_e.id is null then
    return jsonb_build_object('ok',false,'reason','invalid_session');
  end if;

  select * into v_order
  from public.orders
  where id=_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','order_not_found');
  end if;

  if v_order.organization_id<>v_e.organization_id then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if v_order.order_type not in ('delivery','viagem') then
    return jsonb_build_object('ok',false,'reason','not_delivery_order');
  end if;

  if v_order.entregador_id is distinct from v_e.id then
    return jsonb_build_object('ok',false,'reason','not_assigned');
  end if;

  if v_order.status='delivered' then
    return jsonb_build_object('ok',false,'reason','already_delivered');
  end if;

  if v_order.status='cancelled' then
    return jsonb_build_object('ok',false,'reason','cancelled');
  end if;

  if v_order.status<>'out_for_delivery' then
    return jsonb_build_object(
      'ok',false,'reason','not_out_for_delivery',
      'current_status',v_order.status
    );
  end if;

  if coalesce(v_order.delivery_code,'')=''
     or v_order.delivery_code<>_code then
    return jsonb_build_object('ok',false,'reason','invalid_code');
  end if;

  update public.orders
     set status='delivered',
         updated_at=now()
   where id=_order_id;

  insert into public.entregas_log(
    order_id,organization_id,entregador_id,delivered_at
  )
  values(
    _order_id,v_order.organization_id,v_e.id,now()
  )
  on conflict(order_id) do nothing;

  return jsonb_build_object('ok',true,'status','delivered');
end
$$;

revoke all on function public.confirm_delivery_with_code_session(text,uuid,text)
  from public;
grant execute on function public.confirm_delivery_with_code_session(text,uuid,text)
  to anon,authenticated,service_role;
