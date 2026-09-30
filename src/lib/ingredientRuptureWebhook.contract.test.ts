import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type FunctionDefinition = {
  file: string;
  sql: string;
};

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith(".sql"))
  .sort();

const panelSource = readFileSync(
  join(root, "src", "components", "admin", "EstoqueInteligentePanel.tsx"),
  "utf8",
);

const allMigrationsSql = migrationFiles
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
  .join("\n");

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

const consumeSql = normalized(
  latestFunctionDefinition("visionfood_consume_recipe_stock").sql,
);
const syncIngredientSql = normalized(
  latestFunctionDefinition("visionfood_sync_ingredient_state").sql,
);
const restockSql = normalized(
  latestFunctionDefinition("visionfood_restock_recipe_stock").sql,
);
const oneSignalRuptureSql = normalized(
  latestFunctionDefinition("visionfood_push_rupture_trigger").sql,
);
const durableOneSignalRuntimeSql = normalized(
  readFileSync(
    join(
      migrationsDir,
      "20260930101200_visionfood_v2_onesignal_durable_outbox_phase3.sql",
    ),
    "utf8",
  ),
);
const normalizedMigrations = normalized(allMigrationsSql);

describe("ingredient rupture webhook truthfulness contract", () => {
  it("does not advertise or save the orphaned settings.estoque_webhook_url as a working rupture webhook", () => {
    expect(panelSource).not.toContain("estoque_webhook_url");
    expect(panelSource).not.toContain(
      "URL chamada quando um produto for desativado por falta de ingrediente",
    );
  });

  it("keeps the canonical ingredient stock transaction independent from arbitrary webhook URLs", () => {
    expect(consumeSql).not.toContain("estoque_webhook_url");
    expect(consumeSql).not.toContain("net.http_post");
    expect(syncIngredientSql).not.toContain("estoque_webhook_url");
    expect(syncIngredientSql).not.toContain("net.http_post");
    expect(restockSql).not.toContain("estoque_webhook_url");
    expect(restockSql).not.toContain("net.http_post");
  });

  it("proves the stored arbitrary webhook URL is only a legacy schema declaration in migrations", () => {
    const occurrences = allMigrationsSql.match(/estoque_webhook_url/gi) || [];
    expect(occurrences).toHaveLength(1);
    expect(normalizedMigrations).toContain(
      "alter table public.settings add column if not exists estoque_webhook_url text not null default '';",
    );
  });

  it("keeps rupture alerts ingredient-scoped and deduplicated while unresolved", () => {
    expect(syncIngredientSql).toContain("a.organization_id=_organization_id");
    expect(syncIngredientSql).toContain("a.ingrediente_id=_ingredient_id");
    expect(syncIngredientSql).toContain("a.resolvido=false");
    expect(syncIngredientSql).toContain("a.tipo='ruptura'");
    expect(syncIngredientSql).toContain(
      "insert into public.alertas_estoque(",
    );
  });

  it("keeps recovery driven by ingredient state reconciliation instead of inventing a webhook normalization event", () => {
    expect(syncIngredientSql).toContain(
      "set resolvido=true where organization_id=_organization_id and ingrediente_id=_ingredient_id",
    );
    expect(syncIngredientSql).not.toContain("normalization");
    expect(restockSql).not.toContain("estoque_webhook_url");
  });

  it("keeps the existing OneSignal rupture notification on the real positive-to-zero transition", () => {
    expect(oneSignalRuptureSql).toContain(
      "coalesce(old.estoque_atual,0)<=0 or coalesce(new.estoque_atual,0)>0",
    );
    expect(normalizedMigrations).toContain(
      "old.estoque_atual>0 and new.estoque_atual<=0",
    );
    expect(oneSignalRuptureSql).toContain(
      "'organization_id',new.organization_id",
    );
  });

  it("keeps OneSignal transport on the fixed provider endpoint instead of the legacy per-store arbitrary URL", () => {
    expect(durableOneSignalRuntimeSql).toContain(
      "url:='https://api.onesignal.com/notifications'",
    );
    expect(durableOneSignalRuntimeSql).not.toContain("estoque_webhook_url");
  });
});
