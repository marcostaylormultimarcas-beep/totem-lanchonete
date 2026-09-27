import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const dashboardSource = readFileSync(
  join(root, "src", "components", "admin", "DashboardPanel.tsx"),
  "utf8",
);
const multiStoresSource = readFileSync(
  join(root, "src", "components", "admin", "MultiLojasPanel.tsx"),
  "utf8",
);

describe("direct stock low-stock presentation contract", () => {
  it("loads sold_by_weight for Dashboard low-stock rows", () => {
    expect(dashboardSource).toMatch(
      /interface LowStockProduct[\s\S]*?sold_by_weight:\s*boolean;/,
    );
    expect(dashboardSource).toContain(
      ".select('id, name, stock_quantity, low_stock_threshold, manage_stock, sold_by_weight')",
    );
  });

  it("renders Dashboard weighted stock in kilograms instead of generic remaining units", () => {
    expect(dashboardSource).toContain(
      "p.sold_by_weight ? `${p.stock_quantity} kg` : `${p.stock_quantity} un`",
    );
  });

  it("loads sold_by_weight for MultiLojas low-stock rows", () => {
    expect(multiStoresSource).toMatch(
      /interface LowStockRow[\s\S]*?sold_by_weight:\s*boolean;/,
    );
    expect(multiStoresSource).toContain(
      ".select('id, organization_id, name, stock_quantity, low_stock_threshold, manage_stock, sold_by_weight')",
    );
  });

  it("renders MultiLojas weighted stock in kilograms instead of generic remaining units", () => {
    expect(multiStoresSource).toContain(
      "p.sold_by_weight ? `${p.stock_quantity} kg` : `${p.stock_quantity} un`",
    );
  });
});
