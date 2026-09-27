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

function recipeDelta(recipeQuantity: number, multiplier: number) {
  return recipeQuantity * multiplier;
}

const consume = latestFunctionDefinition("visionfood_consume_recipe_stock");
const restock = latestFunctionDefinition("visionfood_restock_recipe_stock");
const consumeSql = normalized(consume.sql);
const restockSql = normalized(restock.sql);
const allMigrationsSql = normalized(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n"),
);

describe("recipe stock historical restock SQL contract", () => {
  it("demonstrates why changing recipe quantity must not change the historical delta", () => {
    const consumed = recipeDelta(0.2, 0.75);
    const recomputedAfterRecipeEdit = recipeDelta(0.3, 0.75);

    expect(consumed).toBeCloseTo(0.15, 10);
    expect(recomputedAfterRecipeEdit).toBeCloseTo(0.225, 10);
    expect(recomputedAfterRecipeEdit).not.toBeCloseTo(consumed, 10);
  });

  it("demonstrates that ingredient swaps must preserve the originally consumed ingredient", () => {
    const consumed = new Map([["ingredient-x", 0.15]]);
    const currentRecipe = new Map([["ingredient-y", 0.15]]);

    expect(consumed.has("ingredient-x")).toBe(true);
    expect(currentRecipe.has("ingredient-x")).toBe(false);
    expect(currentRecipe.has("ingredient-y")).toBe(true);
  });

  it("demonstrates that sold_by_weight flips must not change a stored historical amount", () => {
    const historical = recipeDelta(0.2, 0.75);
    const recalculatedAsUnit = recipeDelta(0.2, 1);

    expect(historical).toBeCloseTo(0.15, 10);
    expect(recalculatedAsUnit).toBeCloseTo(0.2, 10);
    expect(recalculatedAsUnit).not.toBeCloseTo(historical, 10);
  });

  it("persists the actual aggregated ingredient deltas on the order at checkout", () => {
    expect(allMigrationsSql).toContain("ingredient_stock_deltas jsonb");
    expect(consumeSql).toContain("new.ingredient_stock_deltas");
    expect(consumeSql).toContain("'ingredient_id'");
    expect(consumeSql).toContain("'amount'");
  });

  it("restocks only from the immutable historical delta snapshot", () => {
    expect(restockSql).toContain("o.ingredient_stock_deltas");
    expect(restockSql).not.toContain("from public.receitas");
    expect(restockSql).not.toContain("sold_by_weight");
    expect(restockSql).not.toContain("weight_kg");
  });

  it("fails closed when a committed legacy order has no historical snapshot", () => {
    expect(restockSql).toContain("o.ingredient_stock_deltas is null");
    expect(restockSql).toContain("missing ingredient stock snapshot");
  });

  it("prelocks every snapshotted ingredient in deterministic id order before mutation", () => {
    expect(restockSql).toContain(
      "jsonb_array_elements(o.ingredient_stock_deltas)",
    );

    const prelock = restockSql.indexOf("perform i.id from public.ingredientes i");
    const firstMutation = restockSql.indexOf("update public.ingredientes");

    expect(prelock).toBeGreaterThan(-1);
    expect(firstMutation).toBeGreaterThan(prelock);
    expect(restockSql.slice(prelock, firstMutation)).toContain(
      "order by i.id for update of i",
    );
  });

  it("does not mark restock complete until all historical ingredient updates finish", () => {
    const firstIngredientMutation = restockSql.indexOf("update public.ingredientes");
    const completionMarker = restockSql.indexOf(
      "set ingredient_stock_restocked_at=now()",
    );

    expect(firstIngredientMutation).toBeGreaterThan(-1);
    expect(completionMarker).toBeGreaterThan(firstIngredientMutation);
  });

  it("protects the historical delta snapshot from post-sale mutation", () => {
    expect(allMigrationsSql).toContain(
      "create trigger trg_visionfood_guard_ingredient_stock_deltas",
    );
    expect(allMigrationsSql).toContain(
      "ingredient stock snapshot is immutable",
    );
  });
});
