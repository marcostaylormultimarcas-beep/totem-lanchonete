-- PHASE 283: keep anonymous order tracking minimal and fail closed for unavailable organizations.
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

  select
    ord.id,
    ord.order_number,
    ord.status,
    ord.order_type,
    ord.updated_at
  into o
  from public.orders ord
  join public.organizations org
    on org.id=ord.organization_id
  where ord.id=_order_id
    and ord.created_at>now()-interval '30 days'
    and coalesce(org.ativo,true)=true
    and coalesce(org.bloqueado,false)=false
    and coalesce(org.status,'ativo')='ativo'
    and coalesce(org.status_assinatura,'ativo')='ativo'
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
