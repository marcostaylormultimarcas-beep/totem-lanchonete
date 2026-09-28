import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const panelSource = readFileSync(
  join(root, "src", "components", "admin", "EstoqueInteligentePanel.tsx"),
  "utf8",
);

const migrationsDir = join(root, "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith(".sql"))
  .sort();

const migrationSources = migrationFiles.map((file) => ({
  file,
  sql: readFileSync(join(migrationsDir, file), "utf8"),
}));

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ");

describe("ingredient alerts realtime convergence contract", () => {
  it("keeps the authoritative alerts query ordered newest-first and capped at 20", () => {
    expect(panelSource).toContain(".from('alertas_estoque' as any)");
    expect(panelSource).toContain(
      ".order('created_at', { ascending: false }).limit(20)",
    );
  });

  it("has a dedicated alert refresh that preserves the last valid state on transient errors", () => {
    expect(panelSource).toContain("const refreshAlerts");
    expect(panelSource).toContain("alertsRefreshSeq");
    expect(panelSource).toMatch(/if\s*\(error\)\s*\{[\s\S]*?return;[\s\S]*?\}/);
    expect(panelSource).toMatch(/setAlerts\([^)]*data/);
  });

  it("subscribes only to tenant-filterable INSERT and UPDATE events for alertas_estoque", () => {
    expect(panelSource).toMatch(
      /event:\s*'INSERT'[\s\S]*?table:\s*'alertas_estoque'[\s\S]*?filter:\s*\x60organization_id=eq\.\$\{organizationId\}\x60/,
    );
    expect(panelSource).toMatch(
      /event:\s*'UPDATE'[\s\S]*?table:\s*'alertas_estoque'[\s\S]*?filter:\s*\x60organization_id=eq\.\$\{organizationId\}\x60/,
    );
    expect(panelSource).not.toMatch(
      /event:\s*'(?:DELETE|\*)'[\s\S]*?table:\s*'alertas_estoque'/,
    );
  });

  it("guards organization switches and overlapping refreshes from stale writes", () => {
    expect(panelSource).toContain("alertsOrganizationRef");
    expect(panelSource).toMatch(
      /const\s+seq\s*=\s*\+\+alertsRefreshSeq\.current/,
    );
    expect(panelSource).toContain("seq !== alertsRefreshSeq.current");
    expect(panelSource).toContain(
      "alertsOrganizationRef.current !== targetOrganizationId",
    );
  });

  it("removes the realtime channel on cleanup and invalidates in-flight alert refreshes", () => {
    expect(panelSource).toMatch(/supabase\.removeChannel\(channel\)/);
    expect(panelSource).toMatch(
      /return\s*\(\)\s*=>\s*\{[\s\S]*?alertsRefreshSeq\.current\+\+[\s\S]*?removeChannel/,
    );
  });

  it("contains an idempotent migration that publishes alertas_estoque to Supabase Realtime", () => {
    const publicationMigration = migrationSources.find(({ sql }) => {
      const normalized = normalize(sql);
      return (
        normalized.includes("tablename = 'alertas_estoque'") &&
        normalized.includes(
          "alter publication supabase_realtime add table public.alertas_estoque",
        )
      );
    });

    expect(publicationMigration?.file).toBeTruthy();
  });

  it("proves the authoritative backend resolves alerts by UPDATE and does not rely on DELETE semantics", () => {
    const normalizedMigrations = normalize(
      migrationSources.map(({ sql }) => sql).join("\n"),
    );

    expect(normalizedMigrations).toContain(
      "update public.alertas_estoque set resolvido=true",
    );
    expect(normalizedMigrations).toContain(
      "insert into public.alertas_estoque(",
    );
    expect(normalizedMigrations).not.toMatch(
      /delete\s+from\s+public\.alertas_estoque/,
    );
  });
});
