-- Phase 77: reusable checkout guard for forged weight_kg payloads.
create or replace function public.visionfood_assert_checkout_item_weights(_organization_id uuid,_items jsonb)
returns void language plpgsql stable security definer set search_path='' as $$
declare i jsonb; pid uuid; w numeric;
begin
 if _items is null or jsonb_typeof(_items)<>'array' then raise exception 'items must be an array'; end if;
 for i in select value from jsonb_array_elements(_items) loop
   begin pid:=(i->>'product_id')::uuid; w:=nullif(i->>'weight_kg','')::numeric;
   exception when invalid_text_representation then raise exception 'invalid product or weight'; end;
   if not public.visionfood_validate_item_weight(pid,_organization_id,w) then
     raise exception 'invalid weight mode for product';
   end if;
 end loop;
end$$;
revoke all on function public.visionfood_assert_checkout_item_weights(uuid,jsonb) from public,anon,authenticated;
