create or replace function public.visionfood_delivery_history(
  _org uuid,
  _limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  u uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(_limit, 100), 1), 100);
  v_logs jsonb;
begin
  if u is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if _org is null or not private.usuario_dono_org(_org, u) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'order_id', x.order_id,
        'entregador_id', x.entregador_id,
        'delivered_at', x.delivered_at
      )
      order by x.delivered_at desc
    ),
    '[]'::jsonb
  )
  into v_logs
  from (
    select l.id, l.order_id, l.entregador_id, l.delivered_at
    from public.entregas_log l
    where l.organization_id = _org
    order by l.delivered_at desc
    limit v_limit
  ) x;

  return jsonb_build_object('ok', true, 'logs', v_logs);
end
$$;

revoke all on function public.visionfood_delivery_history(uuid,integer)
from public, anon;

grant execute on function public.visionfood_delivery_history(uuid,integer)
to authenticated, service_role;

notify pgrst, 'reload schema';
