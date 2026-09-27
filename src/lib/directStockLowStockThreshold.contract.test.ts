import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith(".sql"))
  .sort();

const ordersPanelSource = readFileSync(
  join(root, "src", "components", "admin", "OrdersPanel.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  join(root, "src", "components", "admin", "DashboardPanel.tsx"),
  "utf8",
);
const multiStoresSource = readFileSync(
  join(root, "src", "components", "admin", "MultiLojasPanel.tsx"),
  "utf8",
);
const adminSource = readFileSync(join(root, "src", "pages", "Admin.tsx"), "utf8");
const allMigrationsSql = migrationFiles
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
  .join("\n");

function normalized(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ");
}

const normalizedMigrations = normalized(allMigrationsSql);

describe("direct stock low-stock threshold contract", () => {
  it("keeps persistent alertas_estoque ingredient-scoped instead of inventing direct-product alert persistence", () => {
    const directStockMigration = readFileSync(
      join(
        migrationsDir,
        "20260927132900_visionfood_v2_direct_stock_historical_restock_contract.sql",
      ),
      "utf8",
    ).toLowerCase();

    expect(directStockMigration).not.toContain("insert into public.alertas_estoque");
    expect(directStockMigration).not.toContain("update public.alertas_estoque");
  });

  it("derives Dashboard low-stock state from each product low_stock_threshold", () => {
    expect(dashboardSource).toContain(
      "Number(p.stock_quantity) <= Number(p.low_stock_threshold)",
    );
  });

  it("derives MultiLojas low-stock state from each product low_stock_threshold", () => {
    expect(multiStoresSource).toContain(
      "Number(p.stock_quantity) <= Number(p.low_stock_threshold)",
    );
  });

  it("does not hard-code the OrdersPanel low-stock threshold to five units", () => {
    expect(ordersPanelSource).not.toContain(".lte('stock_quantity',5)");
    expect(ordersPanelSource).not.toContain(".lte('stock_quantity', 5)");
  });

  it("loads stock_quantity and low_stock_threshold before classifying OrdersPanel low-stock products", () => {
    expect(ordersPanelSource).toContain(
      ".select('id,stock_quantity,low_stock_threshold')",
    );
  });

  it("classifies OrdersPanel low stock with the configured per-product threshold", () => {
    expect(ordersPanelSource).toContain(
      "Number(p.stock_quantity)<=Number(p.low_stock_threshold)",
    );
  });

  it("keeps weighted low-stock thresholds fractional in Admin", () => {
    expect(adminSource).toContain(
      "form.soldByWeight\n      ? parseFloat(form.lowStockThreshold)\n      : parseInt(form.lowStockThreshold, 10)",
    );
    expect(adminSource).toContain(
      "step={form.soldByWeight ? '0.001' : '1'}",
    );
  });

  it("keeps low_stock_threshold non-negative and unit products integral at the database boundary", () => {
    expect(normalizedMigrations).toContain(
      "visionfood_products_low_stock_threshold_semantics",
    );
    expect(normalizedMigrations).toContain("low_stock_threshold >= 0");
    expect(normalizedMigrations).toContain(
      "low_stock_threshold = trunc(low_stock_threshold)",
    );
    expect(normalizedMigrations).toContain("sold_by_weight");
    expect(normalizedMigrations).toContain("not valid");
  });

  it("does not turn a low-stock threshold into products.available state", () => {
    expect(normalizedMigrations).not.toContain(
      "set available = false where stock_quantity <= low_stock_threshold",
    );
    expect(normalizedMigrations).not.toContain(
      "set available=false where stock_quantity<=low_stock_threshold",
    );
  });
});
