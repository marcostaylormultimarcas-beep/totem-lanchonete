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

function globallyBlockedByRecipe(
  recipeQuantity: number,
  ingredientStock: number,
  soldByWeight: boolean,
) {
  if (!(recipeQuantity > 0)) return false;
  return soldByWeight ? ingredientStock <= 0 : ingredientStock < recipeQuantity;
}

function exactWeightFits(
  recipeQuantities: number[],
  ingredientStocks: number[],
  weightKg: number,
) {
  if (!(weightKg > 0)) throw new Error("invalid_weight");
  return recipeQuantities.every(
    (recipeQuantity, index) =>
      ingredientStocks[index] >= Math.max(recipeQuantity, 0) * weightKg,
  );
}

const syncProduct = latestFunctionDefinition(
  "visionfood_sync_product_recipe_availability",
);
const guardProduct = latestFunctionDefinition(
  "visionfood_guard_product_recipe_availability",
);
const syncIngredient = latestFunctionDefinition("visionfood_sync_ingredient_state");
const consumeRecipe = latestFunctionDefinition("visionfood_consume_recipe_stock");

const syncProductSql = normalized(syncProduct.sql);
const guardProductSql = normalized(guardProduct.sql);
const syncIngredientSql = normalized(syncIngredient.sql);
const consumeRecipeSql = normalized(consumeRecipe.sql);
const allMigrationsSql = normalized(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n"),
);

describe("recipe availability weighted SQL contract", () => {
  it("keeps a normal product blocked when ingredient stock cannot cover one unit", () => {
    expect(globallyBlockedByRecipe(0.2, 0.15, false)).toBe(true);
    expect(syncProductSql).toContain("v_sold_by_weight");
    expect(syncProductSql).toContain(
      "not v_sold_by_weight and coalesce(i.estoque_atual,0) < greatest(coalesce(r.quantidade,0),0)",
    );
  });

  it("does not treat one kilogram as the minimum availability requirement for a weighted product", () => {
    expect(globallyBlockedByRecipe(0.2, 0.15, true)).toBe(false);
    expect(syncProductSql).toContain(
      "v_sold_by_weight and coalesce(i.estoque_atual,0)<=0",
    );
  });

  it("keeps a valid smaller weight possible when the exact recipe amount fits", () => {
    expect(exactWeightFits([0.2], [0.15], 0.5)).toBe(true);
    expect(globallyBlockedByRecipe(0.2, 0.15, true)).toBe(false);
  });

  it("blocks a weighted product when a required ingredient is exhausted", () => {
    expect(globallyBlockedByRecipe(0.2, 0, true)).toBe(true);
    expect(guardProductSql).toContain("coalesce(new.sold_by_weight,false)");
    expect(guardProductSql).toContain("coalesce(i.estoque_atual,0)<=0");
  });

  it("keeps every ingredient authoritative for the exact requested weight", () => {
    expect(exactWeightFits([0.2, 0.05], [0.15, 0.03], 0.5)).toBe(true);
    expect(exactWeightFits([0.2, 0.05], [0.15, 0.02], 0.5)).toBe(false);
    expect(consumeRecipeSql).toContain(
      "needed:=greatest(coalesce(rec.quantidade,0),0)*multiplier;",
    );
    expect(consumeRecipeSql).toContain("for update of i");
  });

  it("keeps availability decisions isolated per product when ingredients are shared", () => {
    expect(globallyBlockedByRecipe(0.2, 0.15, true)).toBe(false);
    expect(globallyBlockedByRecipe(0.2, 0.15, false)).toBe(true);
    expect(syncIngredientSql).toContain(
      "perform public.visionfood_sync_product_recipe_availability(",
    );
  });

  it("preserves rupture and minimum-stock alerts independently from weighted catalog availability", () => {
    expect(syncIngredientSql).toContain("if ing.estoque_atual<=0 then");
    expect(syncIngredientSql).toContain(
      "elsif ing.estoque_atual<=ing.estoque_minimo then",
    );
  });

  it("fails closed for an exact weighted checkout that exceeds ingredient stock", () => {
    expect(exactWeightFits([0.2], [0.15], 0.8)).toBe(false);
    expect(() => exactWeightFits([0.2], [0.15], 0)).toThrow("invalid_weight");
    expect(consumeRecipeSql).toContain(
      "raise exception 'insufficient ingredient stock: %',rec.nome;",
    );
  });

  it("uses the same weighted-aware rule when an operator tries to reactivate a product", () => {
    expect(guardProductSql).toContain(
      "not coalesce(new.sold_by_weight,false) and coalesce(i.estoque_atual,0) < greatest(coalesce(r.quantidade,0),0)",
    );
    expect(guardProductSql).toContain(
      "coalesce(new.sold_by_weight,false) and coalesce(i.estoque_atual,0)<=0",
    );
  });

  it("resynchronizes recipe availability when sold_by_weight changes", () => {
    expect(allMigrationsSql).toContain(
      "create trigger trg_visionfood_sync_product_weight_availability after update of sold_by_weight on public.products",
    );
    expect(allMigrationsSql).toContain(
      "perform public.visionfood_sync_product_recipe_availability( new.organization_id, new.id );",
    );
  });
});
