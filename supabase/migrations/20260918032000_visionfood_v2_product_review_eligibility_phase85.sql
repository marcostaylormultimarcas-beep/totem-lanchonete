-- Phase 85: resolve review eligibility server-side from an authenticated delivered order.
create or replace function public.product_review_eligible_order(_product_id uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); oid uuid;
begin
 if u is null then return null; end if;
 select o.id into oid
 from public.orders o
 join public.products p on p.id=_product_id and p.organization_id=o.organization_id
 where o.user_id=u
   and o.status='delivered'
   and exists (
     select 1 from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) it
     where coalesce(nullif(it->>'product_id','')::uuid,
                    nullif(it->>'productId','')::uuid,
                    nullif(it#>>'{product,id}','')::uuid)=_product_id
   )
 order by o.created_at desc
 limit 1;
 return oid;
exception when invalid_text_representation then return null;
end$$;
revoke all on function public.product_review_eligible_order(uuid) from public,anon;
grant execute on function public.product_review_eligible_order(uuid) to authenticated;
