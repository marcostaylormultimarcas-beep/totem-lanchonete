-- PHASE 304 follow-up: robust customer order history + dedicated public combo contract.

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
        'items',o.items,
        'order_type',o.order_type,
        'customer_cpf',o.customer_cpf,
        'nfe_url',o.nfe_url,
        'delivery_code',o.delivery_code
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

revoke all on function public.visionfood_my_orders(integer) from public, anon;
grant execute on function public.visionfood_my_orders(integer) to authenticated, service_role;


create or replace function public.visionfood_public_combo(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  select coalesce((
    select jsonb_build_object(
      'id',p.id,
      'name',p.name,
      'price',p.price,
      'category',p.category,
      'image',coalesce(p.image,''),
      'description',coalesce(p.description,''),
      'organization_id',p.organization_id,
      'available',p.available,
      'is_combo',p.is_combo,
      'removable_ingredients',coalesce(p.removable_ingredients,'[]'::jsonb),
      'extras',coalesce(p.extras,'[]'::jsonb),
      'ingredients',coalesce(p.ingredients,'[]'::jsonb),
      'sold_by_weight',coalesce(p.sold_by_weight,false),
      'prep_time_min',0
    )
    from public.settings s
    join public.products p
      on p.organization_id=s.organization_id
     and p.available=true
     and coalesce(p.is_combo,false)=true
     and (
       p.id=case
         when coalesce(s.combo->>'product_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           then (s.combo->>'product_id')::uuid
         else null
       end
       or p.category='visionfood_combo'
     )
    where s.organization_id=_org
    order by (p.id::text=coalesce(s.combo->>'product_id','')) desc, p.created_at
    limit 1
  ), '{}'::jsonb);
$function$;

revoke all on function public.visionfood_public_combo(uuid) from public;
grant execute on function public.visionfood_public_combo(uuid) to anon, authenticated, service_role;
