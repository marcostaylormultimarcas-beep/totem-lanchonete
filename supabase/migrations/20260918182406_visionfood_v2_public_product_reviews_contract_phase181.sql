create or replace function public.visionfood_public_product_reviews(
  _product_id uuid,
  _limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer;
  v_org uuid;
  v_result jsonb;
begin
  if _product_id is null then
    return '[]'::jsonb;
  end if;

  v_limit := greatest(1, least(coalesce(_limit,20), 50));

  select p.organization_id
  into v_org
  from public.products p
  join public.organizations o on o.id=p.organization_id
  where p.id=_product_id
    and coalesce(p.available,true)=true
    and coalesce(o.ativo,true)=true
    and coalesce(o.bloqueado,false)=false
    and coalesce(o.status,'ativo')='ativo'
    and coalesce(o.status_assinatura,'ativo')='ativo'
  limit 1;

  if v_org is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',q.id,
        'rating',q.rating,
        'comment',coalesce(q.comment,''),
        'created_at',q.created_at
      )
      order by q.created_at desc,q.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select r.id,r.rating,r.comment,r.created_at
    from public.product_reviews r
    where r.product_id=_product_id
      and r.organization_id=v_org
    order by r.created_at desc,r.id desc
    limit v_limit
  ) q;

  return v_result;
end
$function$;

revoke all on function public.visionfood_public_product_reviews(uuid,integer) from public;
grant execute on function public.visionfood_public_product_reviews(uuid,integer) to anon,authenticated;
