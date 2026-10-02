-- VisionFood V2: serialize recipe-writing statements before row-level
-- availability reconciliation acquires ingredient/product locks.
-- Additive migration only. Historical migrations remain untouched.
--
-- Why this exists:
-- The row-level recipe trigger now locks each row's OLD/NEW ingredient/product
-- set deterministically. A transaction that changes several recipe rows can
-- still accumulate different per-row lock sets in a different order from
-- another transaction. Acquire one transaction-scoped writer gate BEFORE each
-- recipe-writing statement starts processing rows so concurrent recipe writers
-- cannot interleave those per-row lock sets.
--
-- The gate is transaction-scoped:
-- - repeated recipe statements in the same transaction reuse the lock;
-- - commit/rollback releases it automatically;
-- - readers and checkout/restock are not serialized by this gate;
-- - checkout/restock keep their existing ingredient -> product hierarchy.

create or replace function public.visionfood_lock_recipe_mutation_statement()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('visionfood_v2_recipe_mutation',0)
  );
  return null;
end
$$;

revoke all on function public.visionfood_lock_recipe_mutation_statement()
  from public,anon,authenticated;

drop trigger if exists trg_visionfood_lock_recipe_mutation_statement
  on public.receitas;

create trigger trg_visionfood_lock_recipe_mutation_statement
before insert or update or delete on public.receitas
for each statement execute function public.visionfood_lock_recipe_mutation_statement();
