import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type FunctionDefinition = {
  file: string;
  sql: string;
};

const migrationsDir = join(process.cwd(), "supabase", "migrations");

function latestFunctionDefinition(name: string): FunctionDefinition {
  const needle = `create or replace function public.${name}`;
  let latest: FunctionDefinition | null = null;

  for (const file of readdirSync(migrationsDir).filter((entry) => entry.endsWith(".sql")).sort()) {
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

function expectedRecipeAmount(
  recipeQuantity: number,
  soldByWeight: boolean,
  quantity: number,
  weightKg?: number,
) {
  const multiplier = soldByWeight ? weightKg : quantity;

  if (soldByWeight && (!Number.isFinite(multiplier) || Number(multiplier) <= 0)) {
    throw new Error("invalid_weight");
  }

  return recipeQuantity * Number(multiplier);
}

const consume = latestFunctionDefinition("visionfood_consume_recipe_stock");
const restock = latestFunctionDefinition("visionfood_restock_recipe_stock");
const consumeSql = normalized(consume.sql);
const restockSql = normalized(restock.sql);

describe("recipe stock weighted SQL contract", () => {
  it("uses quantity for a normal product with quantity=2", () => {
    expect(expectedRecipeAmount(0.2, false, 2)).toBeCloseTo(0.4, 10);
    expect(consumeSql).toContain("multiplier:=case when is_by_weight then weight else qty end;");
    expect(restockSql).toContain("multiplier:=case when is_by_weight then weight else qty end;");
  });

  it("uses weight_kg=0.750 for a sold_by_weight product", () => {
    expect(expectedRecipeAmount(0.2, true, 1, 0.75)).toBeCloseTo(0.15, 10);
    expect(consumeSql).toContain("weight:=nullif(item->>'weight_kg','')::numeric;");
    expect(consumeSql).toContain("if is_by_weight and (weight is null or weight<=0) then");
  });

  it("uses weight_kg=1.250 for a sold_by_weight product", () => {
    expect(expectedRecipeAmount(0.2, true, 1, 1.25)).toBeCloseTo(0.25, 10);
    expect(consumeSql).toContain("ingredient_need as (");
    expect(consumeSql).toContain("needed:=rec.needed;");
    expect(restockSql).toContain("ingredient_amount as (");
    expect(restockSql).toContain("estoque_atual=estoque_atual+rec.amount");
  });

  it("keeps mixed unit and weighted items on independent multipliers", () => {
    const unitAmount = expectedRecipeAmount(0.2, false, 2);
    const weightedAmount = expectedRecipeAmount(0.2, true, 1, 0.75);
    expect(unitAmount + weightedAmount).toBeCloseTo(0.55, 10);
    expect(consumeSql).toContain("for item in select value from jsonb_array_elements(new.items)");
    expect(consumeSql).toContain("select coalesce(p.sold_by_weight,false)");
  });

  it("uses each weighted line weight independently", () => {
    const first = expectedRecipeAmount(0.2, true, 1, 0.25);
    const second = expectedRecipeAmount(0.2, true, 1, 0.75);
    expect(first + second).toBeCloseTo(0.2, 10);
    expect(consumeSql).toContain("multiplier:=case when is_by_weight then weight else qty end;");
  });

  it("restores exactly the same weighted recipe amount on cancellation", () => {
    const consumed = expectedRecipeAmount(0.2, true, 1, 0.75);
    const restored = expectedRecipeAmount(0.2, true, 1, 0.75);
    expect(restored).toBeCloseTo(consumed, 10);
    expect(restockSql).toContain("weight:=nullif(item->>'weight_kg','')::numeric;");
    expect(restockSql).toContain("select coalesce(p.sold_by_weight,false)");
    expect(restockSql).toContain("ingredient_amount as (");
    expect(restockSql).toContain("estoque_atual=estoque_atual+rec.amount");
  });

  it("fails closed for sold_by_weight without a valid weight instead of using quantity=1 as one kilogram", () => {
    expect(() => expectedRecipeAmount(0.2, true, 1)).toThrow("invalid_weight");
    expect(() => expectedRecipeAmount(0.2, true, 1, 0)).toThrow("invalid_weight");
    expect(consumeSql).toContain("raise exception 'invalid ingredient stock weight for product %',pid;");
    expect(restockSql).toContain("raise exception 'invalid ingredient stock weight for product %',pid;");
  });

  it("keeps common products working without requiring weight_kg", () => {
    expect(expectedRecipeAmount(0.4, false, 3)).toBeCloseTo(1.2, 10);
    expect(consumeSql).toContain("qty:=coalesce(nullif(item->>'quantity','')::numeric,1);");
    expect(restockSql).toContain("qty:=coalesce(nullif(item->>'quantity','')::numeric,1);");
  });

  it("keeps ingredient stock idempotency markers and cancellation safety", () => {
    expect(consumeSql).toContain("new.ingredient_stock_committed_at:=now();");
    expect(restockSql).toContain("o.ingredient_stock_committed_at is null");
    expect(restockSql).toContain("o.ingredient_stock_restocked_at is not null");
    expect(restockSql).toContain("set ingredient_stock_restocked_at=now()");
  });

  it("preserves security-definer boundaries for both trigger functions", () => {
    for (const definition of [consume, restock]) {
      const sql = normalized(definition.sql);
      expect(sql).toContain("security definer");
      expect(sql).toMatch(/set search_path(?:=| to )''/);
      expect(sql).toContain("revoke all on function public.");
    }
  });
});
