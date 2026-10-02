import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type FunctionDefinition = { file: string; sql: string };

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");
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

  if (!latest) throw new Error(`Function ${name} was not found in migrations`);
  return latest;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ");
}

const publicCatalogSql = normalized(
  latestFunctionDefinition("visionfood_public_catalog").sql,
);
const pdvCatalogSql = normalized(latestFunctionDefinition("pdv_catalog_v2").sql);
const decrementSql = normalized(
  latestFunctionDefinition("visionfood_decrement_stock_from_order").sql,
);
const quoteSql = normalized(latestFunctionDefinition("quote_order_checkout").sql);
const adminSource = readFileSync(join(root, "src", "pages", "Admin.tsx"), "utf8");
const allMigrationsSql = normalized(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n"),
);

describe("direct stock immediate availability and mutation contract", () => {
  it("keeps public catalog availability dynamic instead of mirroring stock into products.available", () => {
    expect(publicCatalogSql).toContain("coalesce(p.available,true)=true");
    expect(publicCatalogSql).toContain(
      "coalesce(p.ingredient_stock_blocked,false)=false",
    );
    expect(publicCatalogSql).toContain("coalesce(p.manage_stock,false)=false");
    expect(publicCatalogSql).toContain("coalesce(p.stock_quantity,0)>0");
  });

  it("keeps the PDV catalog on the same dynamic direct-stock filter", () => {
    expect(pdvCatalogSql).toContain("coalesce(p.available, true) = true");
    expect(pdvCatalogSql).toContain(
      "coalesce(p.ingredient_stock_blocked, false) = false",
    );
    expect(pdvCatalogSql).toContain("coalesce(p.manage_stock, false) = false");
    expect(pdvCatalogSql).toContain("coalesce(p.stock_quantity, 0) > 0");
  });

  it("keeps final checkout exact and weighted-aware under a product row lock", () => {
    expect(decrementSql).toContain("order by p.id for update of p");
    expect(decrementSql).toContain(
      "when coalesce(p.sold_by_weight,false) then i.weight_kg else i.quantity",
    );
    expect(decrementSql).toContain(
      "if coalesce(rec.stock_quantity,0)<rec.amount then",
    );
  });

  it("stores fractional direct stock for weighted products instead of truncating kilograms", () => {
    expect(adminSource).toContain(
      "form.soldByWeight ? parseFloat(form.stockQuantity) : parseInt(form.stockQuantity, 10)",
    );
  });

  it("uses a fractional step for weighted direct stock while keeping unit products integral", () => {
    expect(adminSource).toContain(
      "step={form.soldByWeight ? '0.001' : '1'}",
    );
  });

  it("does not resend an unchanged stale stock quantity during unrelated product edits", () => {
    expect(adminSource).toContain("delete payload.stock_quantity;");
  });

  it("uses compare-and-swap when an admin intentionally changes stock quantity", () => {
    expect(adminSource).toContain(
      ".eq('stock_quantity', Number(editingProduct.stockQuantity ?? 0))",
    );
    expect(adminSource).toContain("stock_quantity_conflict");
  });

  it("makes the authoritative quote reject an insufficient exact direct-stock request", () => {
    expect(quoteSql).toContain(
      "public.visionfood_direct_stock_request_fits(_organization_id,_items)",
    );
    expect(quoteSql).toContain(
      "coalesce(_product.ingredient_stock_blocked,false)=false",
    );
  });

  it("makes the PDV PIX preflight use the exact weighted direct-stock request", () => {
    expect(allMigrationsSql).toContain(
      "public.visionfood_direct_stock_request_fits(s.organization_id, canonical_items)",
    );
  });

  it("aggregates duplicate lines and switches units from quantity to weight_kg only for weighted products", () => {
    expect(allMigrationsSql).toContain(
      "create or replace function public.visionfood_direct_stock_request_fits",
    );
    expect(allMigrationsSql).toContain(
      "when coalesce(p.sold_by_weight,false) then i.weight_kg else i.quantity",
    );
    expect(allMigrationsSql).toContain("sum(i.amount)");
  });

  it("keeps stock_quantity non-negative for future writes without requiring a historical data rewrite", () => {
    expect(allMigrationsSql).toContain(
      "check (stock_quantity >= 0) not valid",
    );
  });

  it("preserves manual and ingredient blocks independently from direct stock changes", () => {
    expect(publicCatalogSql).toContain("coalesce(p.available,true)=true");
    expect(publicCatalogSql).toContain(
      "coalesce(p.ingredient_stock_blocked,false)=false",
    );
    expect(pdvCatalogSql).toContain("coalesce(p.available, true) = true");
    expect(pdvCatalogSql).toContain(
      "coalesce(p.ingredient_stock_blocked, false) = false",
    );
  });
});
