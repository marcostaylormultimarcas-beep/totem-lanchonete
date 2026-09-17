-- Phase 78: preserve normal quantity checkout while rejecting forged weight on non-weight products.
-- A product marked sold_by_weight may still be ordered by quantity until the product/admin UX
-- has an explicit weight-entry contract; supplied weight, however, is accepted only for marked products.
create or replace function public.visionfood_validate_item_weight(_product_id uuid,_organization_id uuid,_weight numeric)
returns boolean language sql stable security definer set search_path='' as $$
select case when _weight is null then true else exists(
  select 1 from public.products p where p.id=_product_id and p.organization_id=_organization_id
    and p.sold_by_weight=true and _weight>0 and _weight<=100
) end$$;
create or replace function public.visionfood_assert_checkout_item_weights(_organization_id uuid,_items jsonb)
returns void language plpgsql stable security definer set search_path='' as $$
declare i jsonb; pid uuid; w numeric;
begin
 if _items is null or jsonb_typeof(_items)<>'array' then raise exception 'items must be an array'; end if;
 for i in select value from jsonb_array_elements(_items) loop
   begin pid:=(i->>'product_id')::uuid; w:=nullif(i->>'weight_kg','')::numeric;
   exception when invalid_text_representation then raise exception 'invalid product or weight'; end;
   if not public.visionfood_validate_item_weight(pid,_organization_id,w) then raise exception 'invalid weight mode for product'; end if;
 end loop;
end$$;
revoke all on function public.visionfood_validate_item_weight(uuid,uuid,numeric) from public,anon,authenticated;
revoke all on function public.visionfood_assert_checkout_item_weights(uuid,jsonb) from public,anon,authenticated;
