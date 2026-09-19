create or replace function public.visionfood_public_catalog(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'price', p.price,
        'category', p.category,
        'image', p.image,
        'removable_ingredients', coalesce(p.removable_ingredients,'[]'::jsonb),
        'extras', coalesce(p.extras,'[]'::jsonb),
        'is_combo', coalesce(p.is_combo,false),
        'ingredients', coalesce(p.ingredients,'[]'::jsonb),
        'description', coalesce(p.description,''),
        'organization_id', p.organization_id,
        'available', true,
        'codigo_barras', coalesce(p.codigo_barras,''),
        'sold_by_weight', coalesce(p.sold_by_weight,false),
        'prep_time_min', 0
      )
      order by p.name,p.id
    ),
    '[]'::jsonb
  )
  from public.products p
  where p.organization_id=_org
    and coalesce(p.available,true)=true
    and coalesce(p.ingredient_stock_blocked,false)=false
    and (
      coalesce(p.manage_stock,false)=false
      or coalesce(p.stock_quantity,0)>0
    )
$$;

revoke all on function public.visionfood_public_catalog(uuid) from public;
grant execute on function public.visionfood_public_catalog(uuid)
to anon,authenticated,service_role;
