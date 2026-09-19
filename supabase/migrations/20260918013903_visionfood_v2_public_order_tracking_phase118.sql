
create or replace function public.visionfood_public_order_tracking(_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  o record;
begin
  if _order_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_order');
  end if;

  select id,order_number,status,order_type,created_at,updated_at
    into o
  from public.orders
  where id=_order_id
    and created_at>now()-interval '30 days'
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'reason','not_found');
  end if;

  return jsonb_build_object(
    'ok',true,
    'order_id',o.id,
    'order_number',o.order_number,
    'status',o.status,
    'order_type',o.order_type,
    'updated_at',o.updated_at
  );
end
$$;

revoke all on function public.visionfood_public_order_tracking(uuid)
  from public;
grant execute on function public.visionfood_public_order_tracking(uuid)
  to anon,authenticated,service_role;
