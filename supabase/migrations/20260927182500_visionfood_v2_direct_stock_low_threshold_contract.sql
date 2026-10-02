-- VisionFood V2 — direct-stock low-stock threshold semantics.
-- Additive only. No persistent direct-product alert subsystem is introduced.
--
-- Existing direct-stock alerts are derived from products on fresh reads:
-- - stock_quantity <= 0 means rupture/exhausted;
-- - 0 < stock_quantity <= low_stock_threshold means low stock;
-- - stock_quantity > low_stock_threshold means normal;
-- - manage_stock=false opts the product out of direct-stock alert views.
--
-- Unit semantics:
-- - sold_by_weight=true: stock_quantity and low_stock_threshold are kilograms
--   and may be fractional;
-- - sold_by_weight=false: low_stock_threshold is a whole-unit threshold.
--
-- Keep historical stock ledgers, checkout/restock functions, availability,
-- ingredient alerts and the ingredient -> product lock hierarchy untouched.

do $constraint$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conname='visionfood_products_low_stock_threshold_semantics'
       and c.conrelid='public.products'::regclass
  ) then
    alter table public.products
      add constraint visionfood_products_low_stock_threshold_semantics
      check (
        low_stock_threshold >= 0
        and (
          coalesce(sold_by_weight,false)=true
          or low_stock_threshold = trunc(low_stock_threshold)
        )
      ) not valid;
  end if;
end
$constraint$;
