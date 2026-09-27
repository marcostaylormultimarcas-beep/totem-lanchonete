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

const syncRecipe = latestFunctionDefinition("visionfood_sync_recipe_state_trigger");
const syncProduct = latestFunctionDefinition(
  "visionfood_sync_product_recipe_availability",
);
const guardProduct = latestFunctionDefinition(
  "visionfood_guard_product_recipe_availability",
);
const syncWeight = latestFunctionDefinition(
  "visionfood_sync_product_weight_availability_trigger",
);

const syncRecipeSql = normalized(syncRecipe.sql);
const syncProductSql = normalized(syncProduct.sql);
const guardProductSql = normalized(guardProduct.sql);
const syncWeightSql = normalized(syncWeight.sql);
const allMigrationsSql = normalized(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n"),
);

describe("recipe mutation immediate availability reconciliation SQL contract", () => {
  it("keeps an AFTER INSERT/UPDATE/DELETE trigger on receitas", () => {
    expect(allMigrationsSql).toContain(
      "create trigger trg_visionfood_sync_recipe_state after insert or update or delete on public.receitas",
    );
  });

  it("reconciles the OLD product and ingredient for UPDATE/DELETE", () => {
    expect(syncRecipeSql).toContain("if tg_op in ('update','delete') then");
    expect(syncRecipeSql).toContain(
      "old_product:=coalesce(old.product_id,old.produto_id)",
    );
    expect(syncRecipeSql).toContain(
      "old_ingredient:=coalesce(old.ingrediente_id,old.ingredient_id)",
    );
    expect(syncRecipeSql).toContain(
      "perform public.visionfood_sync_product_recipe_availability(old_org,old_product)",
    );
    expect(syncRecipeSql).toContain(
      "perform public.visionfood_sync_ingredient_state(old_org,old_ingredient,old_product)",
    );
  });

  it("reconciles the NEW product and ingredient for INSERT/UPDATE", () => {
    expect(syncRecipeSql).toContain("if tg_op in ('insert','update') then");
    expect(syncRecipeSql).toContain(
      "new_product:=coalesce(new.product_id,new.produto_id)",
    );
    expect(syncRecipeSql).toContain(
      "new_ingredient:=coalesce(new.ingrediente_id,new.ingredient_id)",
    );
    expect(syncRecipeSql).toContain(
      "perform public.visionfood_sync_product_recipe_availability(new_org,new_product)",
    );
    expect(syncRecipeSql).toContain(
      "perform public.visionfood_sync_ingredient_state(new_org,new_ingredient,new_product)",
    );
  });

  it("fires for quantity-only recipe changes", () => {
    expect(allMigrationsSql).toContain(
      "after insert or update or delete on public.receitas",
    );
  });

  it("moves a recipe between products by reconciling both OLD and NEW sides", () => {
    const oldSync = syncRecipeSql.indexOf(
      "perform public.visionfood_sync_product_recipe_availability(old_org,old_product)",
    );
    const newSync = syncRecipeSql.indexOf(
      "perform public.visionfood_sync_product_recipe_availability(new_org,new_product)",
    );

    expect(oldSync).toBeGreaterThan(-1);
    expect(newSync).toBeGreaterThan(oldSync);
  });

  it("moves a recipe between ingredients by reconciling both OLD and NEW ingredient states", () => {
    expect(syncRecipeSql).toContain(
      "perform public.visionfood_sync_ingredient_state(old_org,old_ingredient,old_product)",
    );
    expect(syncRecipeSql).toContain(
      "perform public.visionfood_sync_ingredient_state(new_org,new_ingredient,new_product)",
    );
  });

  it("reconciles the first inserted recipe immediately", () => {
    expect(syncRecipeSql).toContain("if tg_op in ('insert','update') then");
    expect(syncRecipeSql).toContain(
      "perform public.visionfood_sync_product_recipe_availability(new_org,new_product)",
    );
  });

  it("reconciles the product after deleting its last recipe row", () => {
    expect(syncRecipeSql).toContain("if tg_op in ('update','delete') then");
    expect(syncRecipeSql).toContain(
      "perform public.visionfood_sync_product_recipe_availability(old_org,old_product)",
    );
    expect(syncProductSql).toContain(
      "and p.ingredient_stock_blocked=true",
    );
    expect(syncProductSql).toContain(
      "set available=true, ingredient_stock_blocked=false",
    );
  });

  it("evaluates the complete current recipe instead of only the changed row", () => {
    expect(syncProductSql).toContain("from public.receitas r");
    expect(syncProductSql).toContain(
      "coalesce(r.product_id,r.produto_id)=_product_id",
    );
    expect(syncProductSql).toContain("select exists(");
  });

  it("keeps unit-product availability dependent on one full recipe unit", () => {
    expect(syncProductSql).toContain(
      "not v_sold_by_weight and coalesce(i.estoque_atual,0) < greatest(coalesce(r.quantidade,0),0)",
    );
  });

  it("keeps weighted-product catalog availability blocked only at exhaustion", () => {
    expect(syncProductSql).toContain(
      "v_sold_by_weight and coalesce(i.estoque_atual,0)<=0",
    );
  });

  it("resynchronizes availability when sold_by_weight changes in either direction", () => {
    expect(allMigrationsSql).toContain(
      "create trigger trg_visionfood_sync_product_weight_availability after update of sold_by_weight on public.products",
    );
    expect(syncWeightSql).toContain(
      "perform public.visionfood_sync_product_recipe_availability( new.organization_id, new.id )",
    );
  });

  it("guards manual attempts to reactivate products with the same weighted-aware rule", () => {
    expect(guardProductSql).toContain(
      "not coalesce(new.sold_by_weight,false) and coalesce(i.estoque_atual,0) < greatest(coalesce(r.quantidade,0),0)",
    );
    expect(guardProductSql).toContain(
      "coalesce(new.sold_by_weight,false) and coalesce(i.estoque_atual,0)<=0",
    );
  });

  it("preserves manual unavailable=false/ingredient_stock_blocked=false state", () => {
    expect(syncProductSql).toContain(
      "and p.ingredient_stock_blocked=true",
    );
    expect(syncProductSql).toContain(
      "when p.available is true then true else p.ingredient_stock_blocked",
    );
  });

  it("does not couple recipe changes to unrelated products", () => {
    expect(syncProductSql).toContain(
      "where p.id=_product_id and p.organization_id=_organization_id",
    );
  });

  it("prelocks every product that OLD/NEW recipe reconciliation can touch before the first product sync", () => {
    const prelock = syncRecipeSql.indexOf("perform p.id from public.products p");
    const firstSync = syncRecipeSql.indexOf(
      "perform public.visionfood_sync_product_recipe_availability",
    );

    expect(prelock).toBeGreaterThan(-1);
    expect(firstSync).toBeGreaterThan(prelock);
  });

  it("includes explicit OLD/NEW products and products related to OLD/NEW ingredients in that prelock", () => {
    const prelock = syncRecipeSql.indexOf("perform p.id from public.products p");
    const firstSync = syncRecipeSql.indexOf(
      "perform public.visionfood_sync_product_recipe_availability",
    );
    const lockSlice = syncRecipeSql.slice(prelock, firstSync);

    expect(lockSlice).toContain("p.id=old_product");
    expect(lockSlice).toContain("p.id=new_product");
    expect(lockSlice).toContain(
      "coalesce(r.ingrediente_id,r.ingredient_id)=old_ingredient",
    );
    expect(lockSlice).toContain(
      "coalesce(r.ingrediente_id,r.ingredient_id)=new_ingredient",
    );
  });

  it("acquires the recipe-mutation product lock union in deterministic UUID order", () => {
    const prelock = syncRecipeSql.indexOf("perform p.id from public.products p");
    const firstSync = syncRecipeSql.indexOf(
      "perform public.visionfood_sync_product_recipe_availability",
    );
    const lockSlice = syncRecipeSql.slice(prelock, firstSync);

    expect(lockSlice).toContain("order by p.id for update of p");
  });
});
