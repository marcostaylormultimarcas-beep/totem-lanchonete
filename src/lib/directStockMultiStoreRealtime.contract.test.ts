import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src", "components", "admin", "MultiLojasPanel.tsx"),
  "utf8",
);

describe("direct stock multi-store realtime contract", () => {
  it("has a dedicated low-stock refresh that re-reads the current direct-stock state", () => {
    expect(source).toContain("const refreshLowStock");
    expect(source).toContain(
      ".select('id, organization_id, name, stock_quantity, low_stock_threshold, manage_stock, sold_by_weight')",
    );
    expect(source).toContain(".eq('manage_stock', true)");
    expect(source).toContain(
      "Number(p.stock_quantity) <= Number(p.low_stock_threshold)",
    );
  });

  it("subscribes to product changes instead of waiting for a manual reload or period change", () => {
    expect(source).toContain("table: 'products'");
    expect(source).toMatch(
      /\.on\(\s*'postgres_changes',[\s\S]*?table:\s*'products'[\s\S]*?\(\)\s*=>\s*\{?[\s\S]*?refreshLowStock/,
    );
  });

  it("scopes every realtime product subscription to one authorized organization", () => {
    expect(source).toContain(
      "filter: `organization_id=eq.${organizationId}`",
    );
    expect(source).toMatch(/ids\.map\(\(organizationId\)\s*=>/);
  });

  it("uses organization-specific channel names so parallel stores do not collide", () => {
    expect(source).toMatch(
      /channel\(`multi-lojas-products-\$\{userId\}-\$\{organizationId\}`\)/,
    );
  });

  it("removes every realtime channel on cleanup to avoid duplicate subscriptions", () => {
    expect(source).toMatch(/channels\.forEach\([\s\S]*?supabase\.removeChannel\(ch\)/);
  });

  it("guards overlapping low-stock refreshes so an older response cannot overwrite a newer one", () => {
    expect(source).toContain("lowStockRefreshSeq");
    expect(source).toMatch(/const\s+seq\s*=\s*\+\+lowStockRefreshSeq\.current/);
    expect(source).toContain("seq !== lowStockRefreshSeq.current");
  });

  it("does not write products.available while reconciling visual low-stock state", () => {
    expect(source).not.toMatch(/\.update\(\{[\s\S]*?available\s*:/);
  });
});
