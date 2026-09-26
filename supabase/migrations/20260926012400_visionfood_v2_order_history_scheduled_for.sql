create or replace function public.visionfood_my_orders(_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  uid uuid:=auth.uid();
  safe_limit integer:=least(greatest(coalesce(_limit,50),1),50);
  result jsonb;
begin
  if uid is null then
    raise exception 'unauthenticated';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'total',o.total,
        'status',o.status,
        'created_at',o.created_at,
        'scheduled_for',o.scheduled_for,
        'items',o.items,
        'order_type',o.order_type,
        'customer_cpf',o.customer_cpf,
        'nfe_url',o.nfe_url,
        'delivery_code',o.delivery_code,
        'loyalty_points_awarded',coalesce((
          select l.points
          from public.loyalty_points_ledger l
          where l.order_id=o.id and l.entry_type='earn'
          order by l.created_at desc
          limit 1
        ),0),
        'loyalty_points_reversed',exists(
          select 1
          from public.loyalty_points_ledger l
          where l.order_id=o.id and l.entry_type='reversal'
        )
      )
      order by o.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from (
    select *
    from public.orders
    where user_id=uid
    order by created_at desc
    limit safe_limit
  ) o;

  return result;
end
$function$;

revoke all on function public.visionfood_my_orders(integer) from public,anon;
grant execute on function public.visionfood_my_orders(integer) to authenticated;
