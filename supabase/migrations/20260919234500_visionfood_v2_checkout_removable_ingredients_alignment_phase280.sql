-- Phase 280: align authoritative checkout removal validation with the
-- public catalog/UI allowlist. The kiosk only offers removable_ingredients;
-- validating against the informational ingredients list rejected legitimate
-- removals and could accept non-removable ingredients through direct RPC calls.

create or replace function public.visionfood_assert_checkout_item_weights(
  _organization_id uuid,
  _items jsonb
)
returns void
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  i jsonb;
  pid uuid;
  w numeric;
  p_removable_ingredients jsonb;
  removed_name text;
begin
  if _items is null or jsonb_typeof(_items)<>'array' then
    raise exception 'items must be an array';
  end if;

  for i in select value from jsonb_array_elements(_items)
  loop
    begin
      pid := (i->>'product_id')::uuid;
      w := nullif(i->>'weight_kg','')::numeric;
    exception when invalid_text_representation then
      raise exception 'invalid product or weight';
    end;

    if not public.visionfood_validate_item_weight(pid,_organization_id,w) then
      raise exception 'invalid weight mode for product';
    end if;

    select coalesce(p.removable_ingredients,'[]'::jsonb)
      into p_removable_ingredients
      from public.products p
     where p.id=pid
       and p.organization_id=_organization_id
     limit 1;

    if not found then
      raise exception 'product is invalid or unavailable';
    end if;

    if jsonb_typeof(coalesce(i->'removedIngredients','[]'::jsonb))<>'array' then
      raise exception 'invalid removed ingredients list';
    end if;

    for removed_name in
      select jsonb_array_elements_text(coalesce(i->'removedIngredients','[]'::jsonb))
    loop
      if nullif(btrim(removed_name),'') is null
         or length(removed_name)>120
         or not exists (
           select 1
           from jsonb_array_elements_text(
             case
               when jsonb_typeof(p_removable_ingredients)='array'
                 then p_removable_ingredients
               else '[]'::jsonb
             end
           ) ing(value)
           where ing.value=removed_name
         ) then
        raise exception 'invalid removed ingredient for product';
      end if;
    end loop;
  end loop;
end
$$;

revoke all on function public.visionfood_assert_checkout_item_weights(uuid,jsonb)
from public,anon,authenticated;
grant execute on function public.visionfood_assert_checkout_item_weights(uuid,jsonb)
to service_role;
