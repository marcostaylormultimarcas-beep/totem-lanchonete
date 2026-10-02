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

function historicalDirectDelta(
  manageStockAtSale: boolean,
  soldByWeightAtSale: boolean,
  quantity: number,
  weightKg?: number,
) {
  if (!manageStockAtSale) return 0;
  if (soldByWeightAtSale) {
    if (!Number.isFinite(weightKg) || Number(weightKg) <= 0) {
      throw new Error("invalid_weight");
    }
    return Number(weightKg);
  }
  return quantity;
}

const decrement = latestFunctionDefinition("visionfood_decrement_stock_from_order");
const restock = latestFunctionDefinition("visionfood_restock_cancelled_order");
const finalizeCancel = latestFunctionDefinition("visionfood_finalize_order_cancellation");

const decrementSql = normalized(decrement.sql);
const restockSql = normalized(restock.sql);
const finalizeCancelSql = normalized(finalizeCancel.sql);
const allMigrationsSql = normalized(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n"),
);

describe("direct product stock historical restock SQL contract", () => {
  it("demonstrates that sold_by_weight true -> false must preserve the 0.750 historical delta", () => {
    const consumed = historicalDirectDelta(true, true, 1, 0.75);
    const wronglyRecomputedAsUnit = historicalDirectDelta(true, false, 1, 0.75);

    expect(consumed).toBeCloseTo(0.75, 10);
    expect(wronglyRecomputedAsUnit).toBeCloseTo(1, 10);
    expect(wronglyRecomputedAsUnit).not.toBeCloseTo(consumed, 10);
  });

  it("demonstrates that sold_by_weight false -> true must preserve the unit quantity historical delta", () => {
    const consumed = historicalDirectDelta(true, false, 3);
    expect(consumed).toBe(3);
    expect(() => historicalDirectDelta(true, true, 3)).toThrow("invalid_weight");
  });

  it("demonstrates why manage_stock changes cannot be reconstructed from current product configuration", () => {
    expect(historicalDirectDelta(true, false, 2)).toBe(2);
    expect(historicalDirectDelta(false, false, 2)).toBe(0);
  });

  it("persists the actual aggregated direct-stock deltas in a private historical ledger", () => {
    expect(allMigrationsSql).toContain(
      "create table if not exists public.visionfood_order_product_stock_ledger",
    );
    expect(allMigrationsSql).toContain("primary key(order_id,product_id)");
    expect(decrementSql).toContain(
      "insert into public.visionfood_order_product_stock_ledger",
    );
    expect(decrementSql).toContain("new.stock_snapshot_version:=1;");
  });

  it("aggregates repeated lines by product before decrementing stock", () => {
    expect(decrementSql).toContain("product_usage");
    expect(decrementSql).toMatch(
      /sum\([^)]*amount[^)]*\)|coalesce\([^)]*product_usage[^)]*\)\s*\+/,
    );
  });

  it("locks every direct-stock product in deterministic product-id order before mutation", () => {
    const prelock = decrementSql.indexOf("perform p.id from public.products p");
    const firstMutation = decrementSql.indexOf("update public.products");

    expect(prelock).toBeGreaterThan(-1);
    expect(firstMutation).toBeGreaterThan(prelock);
    expect(decrementSql.slice(prelock, firstMutation)).toContain(
      "order by p.id for update of p",
    );
  });

  it("restocks only from the immutable direct-stock delta snapshot", () => {
    expect(restockSql).toContain(
      "from public.visionfood_order_product_stock_ledger",
    );
    expect(restockSql).not.toContain("jsonb_array_elements(o.items)");
    expect(restockSql).not.toContain("sold_by_weight");
    expect(restockSql).not.toContain("manage_stock");
    expect(restockSql).not.toContain("weight_kg");
  });

  it("fails closed for a committed legacy order without a trustworthy direct-stock snapshot", () => {
    expect(restockSql).toContain("o.stock_snapshot_version");
    expect(restockSql).toContain("missing product stock snapshot");
  });

  it("fails closed when a historically consumed product row no longer exists", () => {
    expect(restockSql).toContain("missing product from stock snapshot");
  });

  it("does not mark direct restock complete until all historical product updates finish", () => {
    const firstProductMutation = restockSql.indexOf("update public.products");
    const completionMarker = restockSql.indexOf("set stock_restocked_at=now()");

    expect(firstProductMutation).toBeGreaterThan(-1);
    expect(completionMarker).toBeGreaterThan(firstProductMutation);
  });

  it("keeps the direct-stock ledger private and preserves ingredient -> product cancellation lock hierarchy", () => {
    expect(allMigrationsSql).toContain(
      "alter table public.visionfood_order_product_stock_ledger enable row level security",
    );
    expect(allMigrationsSql).toContain(
      "revoke all on table public.visionfood_order_product_stock_ledger from public,anon,authenticated",
    );
    expect(allMigrationsSql).not.toContain(
      "update public.visionfood_order_product_stock_ledger",
    );

    const recipeRestock = finalizeCancelSql.indexOf(
      "perform public.visionfood_restock_recipe_stock(new.id);",
    );
    const productRestock = finalizeCancelSql.indexOf(
      "perform public.visionfood_restock_cancelled_order(new.id);",
    );

    expect(recipeRestock).toBeGreaterThan(-1);
    expect(productRestock).toBeGreaterThan(recipeRestock);
  });
});
