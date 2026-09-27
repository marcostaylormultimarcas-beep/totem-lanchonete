import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type FunctionDefinition = {
  file: string;
  sql: string;
};

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith(".sql"))
  .sort();

function latestFunctionDefinition(name: string): FunctionDefinition {
  const needle = `create or replace function public.${name}(`;
  let latest: FunctionDefinition | null = null;

  for (const file of migrationFiles) {
    const fullSql = readFileSync(join(migrationsDir, file), "utf8");
    const lowerSql = fullSql.toLowerCase();
    const start = lowerSql.lastIndexOf(needle.toLowerCase());

    if (start < 0) continue;

    const nextFunction = lowerSql.indexOf(
      "\ncreate or replace function public.",
      start + needle.length,
    );

    latest = {
      file,
      sql: fullSql.slice(start, nextFunction >= 0 ? nextFunction : fullSql.length),
    };
  }

  if (!latest) {
    throw new Error(`Function ${name} was not found in migrations`);
  }

  return latest;
}

function normalized(sql: string) {
  return sql.toLowerCase().replace(/\s+/g, " ");
}

const consume = latestFunctionDefinition("visionfood_consume_recipe_stock");
const restock = latestFunctionDefinition("visionfood_restock_recipe_stock");
const syncIngredient = latestFunctionDefinition("visionfood_sync_ingredient_state");
const syncProduct = latestFunctionDefinition(
  "visionfood_sync_product_recipe_availability",
);
const finalizeCancel = latestFunctionDefinition(
  "visionfood_finalize_order_cancellation",
);

const consumeSql = normalized(consume.sql);
const restockSql = normalized(restock.sql);
const syncIngredientSql = normalized(syncIngredient.sql);
const syncProductSql = normalized(syncProduct.sql);
const finalizeCancelSql = normalized(finalizeCancel.sql);
const allMigrationsSql = normalized(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n"),
);

describe("recipe historical restock reconciliation SQL contract", () => {
  it("keeps the ingredient update trigger wired to stock changes", () => {
    expect(allMigrationsSql).toContain(
      "create trigger trg_visionfood_sync_ingredient_state after insert or update of estoque_atual,estoque_minimo on public.ingredientes",
    );
    expect(allMigrationsSql).toContain(
      "perform public.visionfood_sync_ingredient_state( new.organization_id, new.id, null );",
    );
  });

  it("restores the historical delta from the immutable ingredient ledger", () => {
    expect(restockSql).toContain(
      "from public.visionfood_order_ingredient_stock_ledger",
    );
    expect(restockSql).not.toContain("from public.receitas");
    expect(restockSql).toContain("set estoque_atual=estoque_atual+rec.amount");
  });

  it("reconciles products from the current recipe graph after stock changes", () => {
    expect(syncIngredientSql).toContain("from public.receitas r");
    expect(syncIngredientSql).toContain(
      "coalesce(r.ingrediente_id,r.ingredient_id)=_ingredient_id",
    );
    expect(syncIngredientSql).toContain(
      "perform public.visionfood_sync_product_recipe_availability(",
    );
  });

  it("keeps current weighted and unit availability rules after restock", () => {
    expect(syncProductSql).toContain("v_sold_by_weight");
    expect(syncProductSql).toContain(
      "not v_sold_by_weight and coalesce(i.estoque_atual,0) < greatest(coalesce(r.quantidade,0),0)",
    );
    expect(syncProductSql).toContain(
      "v_sold_by_weight and coalesce(i.estoque_atual,0)<=0",
    );
  });

  it("preserves manual unavailability represented by ingredient_stock_blocked=false", () => {
    expect(syncProductSql).toContain(
      "and p.ingredient_stock_blocked=true",
    );
    expect(syncProductSql).toContain(
      "set available=true, ingredient_stock_blocked=false",
    );
  });

  it("resolves rupture and opens minimum when restored stock remains at or below minimum", () => {
    expect(syncIngredientSql).toContain(
      "elsif ing.estoque_atual<=ing.estoque_minimo then",
    );
    expect(syncIngredientSql).toContain("and tipo='ruptura'");
    expect(syncIngredientSql).toContain("and a.tipo='minimo'");
  });

  it("resolves rupture and minimum when restored stock is above minimum", () => {
    expect(syncIngredientSql).toContain(
      "and tipo in ('ruptura','minimo')",
    );
  });

  it("resolves stale ingredient alerts when the ingredient no longer belongs to a live recipe", () => {
    expect(syncIngredientSql).toContain("if not v_has_recipe then");
    expect(syncIngredientSql).toContain(
      "and tipo in ('ruptura','minimo')",
    );
  });

  it("reconciles every currently related product in deterministic product-id order", () => {
    expect(syncIngredientSql).toContain(
      "select distinct coalesce(r.product_id,r.produto_id)",
    );
    expect(syncIngredientSql).toContain(
      "order by coalesce(r.product_id,r.produto_id)",
    );
  });

  it("keeps cancellation ingredient restock before direct product restock", () => {
    const ingredient = finalizeCancelSql.indexOf(
      "perform public.visionfood_restock_recipe_stock(new.id);",
    );
    const direct = finalizeCancelSql.indexOf(
      "perform public.visionfood_restock_cancelled_order(new.id);",
    );

    expect(ingredient).toBeGreaterThan(-1);
    expect(direct).toBeGreaterThan(ingredient);
  });

  it("keeps historical ingredient restock idempotent", () => {
    expect(restockSql).toContain(
      "o.ingredient_stock_restocked_at is not null",
    );
    expect(restockSql).toContain(
      "set ingredient_stock_restocked_at=now()",
    );
  });

  it("prelocks the complete cancellation product union before the first ingredient mutation", () => {
    const productPrelock = restockSql.indexOf(
      "perform p.id from public.products p",
    );
    const firstIngredientMutation = restockSql.indexOf(
      "update public.ingredientes",
    );

    expect(productPrelock).toBeGreaterThan(-1);
    expect(firstIngredientMutation).toBeGreaterThan(productPrelock);
    expect(restockSql.slice(productPrelock, firstIngredientMutation)).toContain(
      "order by p.id for update of p",
    );
  });

  it("includes current recipe products and historical direct-stock products in the cancellation prelock", () => {
    const productPrelock = restockSql.indexOf(
      "perform p.id from public.products p",
    );
    const firstIngredientMutation = restockSql.indexOf(
      "update public.ingredientes",
    );
    const lockSlice = restockSql.slice(productPrelock, firstIngredientMutation);

    expect(lockSlice).toContain("from public.receitas");
    expect(lockSlice).toContain(
      "public.visionfood_order_product_stock_ledger",
    );
  });

  it("prelocks the complete checkout product union before ingredient update triggers can acquire product locks", () => {
    const productPrelock = consumeSql.indexOf(
      "perform p.id from public.products p",
    );
    const firstIngredientMutation = consumeSql.indexOf(
      "update public.ingredientes",
    );

    expect(productPrelock).toBeGreaterThan(-1);
    expect(firstIngredientMutation).toBeGreaterThan(productPrelock);
    expect(consumeSql.slice(productPrelock, firstIngredientMutation)).toContain(
      "order by p.id for update of p",
    );
  });
});
