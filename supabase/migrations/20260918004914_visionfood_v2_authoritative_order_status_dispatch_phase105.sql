
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

create or replace function public.visionfood_dispatch_orders(
  _order_ids uuid[],
  _entregador_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  e public.entregadores%rowtype;
  o public.orders%rowtype;
  v_expected int;
  v_seen int:=0;
  v_distinct int;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  v_expected:=coalesce(cardinality(_order_ids),0);
  if v_expected<1 or v_expected>200 then
    return jsonb_build_object('ok',false,'reason','invalid_order_count');
  end if;

  select count(distinct x)::int
    into v_distinct
  from unnest(_order_ids) as t(x);

  if v_distinct<>v_expected then
    return jsonb_build_object('ok',false,'reason','duplicate_order_id');
  end if;

  select * into e
  from public.entregadores
  where id=_entregador_id
    and coalesce(active,true)=true
    and coalesce(ativo,true)=true;

  if not found then
    return jsonb_build_object('ok',false,'reason','entregador_invalid');
  end if;

  if not public.usuario_dono_org(e.organization_id,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  for o in
    select *
    from public.orders
    where id=any(_order_ids)
    order by id
    for update
  loop
    v_seen:=v_seen+1;

    if o.organization_id is distinct from e.organization_id then
      return jsonb_build_object(
        'ok',false,'reason','cross_organization_order','order_id',o.id
      );
    end if;

    if o.order_type not in ('delivery','viagem') then
      return jsonb_build_object(
        'ok',false,'reason','not_delivery_order','order_id',o.id
      );
    end if;

    if o.status<>'ready' then
      return jsonb_build_object(
        'ok',false,'reason','status_changed',
        'order_id',o.id,'current_status',o.status
      );
    end if;

    if o.entregador_id is not null
       and o.entregador_id is distinct from _entregador_id then
      return jsonb_build_object(
        'ok',false,'reason','already_assigned',
        'order_id',o.id,'entregador_id',o.entregador_id
      );
    end if;
  end loop;

  if v_seen<>v_expected then
    return jsonb_build_object('ok',false,'reason','order_not_found');
  end if;

  update public.orders
     set entregador_id=_entregador_id,
         status='out_for_delivery',
         updated_at=now()
   where id=any(_order_ids);

  return jsonb_build_object(
    'ok',true,
    'count',v_expected,
    'entregador_id',_entregador_id
  );
end
$$;

revoke all on function public.visionfood_dispatch_orders(uuid[],uuid)
  from public,anon;
grant execute on function public.visionfood_dispatch_orders(uuid[],uuid)
  to authenticated;
