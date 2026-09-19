-- Phase 75: explicit server-side product contract for weight sales.
alter table public.products add column if not exists sold_by_weight boolean not null default false;
create or replace function public.visionfood_validate_item_weight(_product_id uuid,_organization_id uuid,_weight numeric)
returns boolean language sql stable security definer set search_path='' as $$
select case when _weight is null then true else exists(
  select 1 from public.products p where p.id=_product_id and p.organization_id=_organization_id
  and p.sold_by_weight=true and _weight>0 and _weight<=100
) end$$;
revoke all on function public.visionfood_validate_item_weight(uuid,uuid,numeric) from public,anon,authenticated;
