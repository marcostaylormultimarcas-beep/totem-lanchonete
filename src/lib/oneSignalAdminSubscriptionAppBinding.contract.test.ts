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

const oneSignalSource = readFileSync(
  join(root, "src", "lib", "onesignal.ts"),
  "utf8",
);

function latestFunctionDefinition(
  schema: "public" | "private",
  name: string,
): FunctionDefinition {
  const needle = `create or replace function ${schema}.${name}(`;
  let latest: FunctionDefinition | null = null;

  for (const file of migrationFiles) {
    const fullSql = readFileSync(join(migrationsDir, file), "utf8");
    const lowerSql = fullSql.toLowerCase();
    const start = lowerSql.lastIndexOf(needle.toLowerCase());
    if (start < 0) continue;

    const nextFunction = lowerSql.indexOf(
      "\ncreate or replace function ",
      start + needle.length,
    );

    latest = {
      file,
      sql: fullSql.slice(start, nextFunction >= 0 ? nextFunction : fullSql.length),
    };
  }

  if (!latest) {
    throw new Error(`Function ${schema}.${name} was not found in migrations`);
  }

  return latest;
}

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ");

const allSql = migrationFiles
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
  .join("\n");

const reconcileSql = normalize(
  latestFunctionDefinition(
    "public",
    "visionfood_reconcile_admin_push_subscription",
  ).sql,
);
const audienceSql = normalize(
  latestFunctionDefinition(
    "private",
    "visionfood_admin_push_subscription_ids",
  ).sql,
);
const configSql = normalize(
  latestFunctionDefinition("public", "set_onesignal_config").sql,
);

describe("OneSignal admin registry App ID binding", () => {
  it("stores the OneSignal App ID alongside every authoritative admin subscription", () => {
    expect(allSql).toMatch(
      /onesignal_admin_push_subscriptions[\s\S]*add column if not exists app_id text/i,
    );
    expect(allSql).toMatch(
      /onesignal_admin_push_subscriptions[\s\S]*alter column app_id set not null/i,
    );
  });

  it("requires the browser SDK App ID during reconciliation and rejects a stale App ID", () => {
    expect(reconcileSql).toMatch(
      /visionfood_reconcile_admin_push_subscription\s*\(\s*_org uuid\s*,\s*_subscription_id text\s*,\s*_client_instance_id uuid\s*,\s*_app_id text/i,
    );
    expect(reconcileSql).toContain("app_id_mismatch");
    expect(reconcileSql).toMatch(
      /from private\.onesignal_settings[\s\S]*for share/,
    );
    expect(reconcileSql).toMatch(/app_id[\s\S]*values/);
  });

  it("only returns subscription IDs bound to the currently configured OneSignal App ID", () => {
    expect(audienceSql).toMatch(
      /from private\.onesignal_settings[\s\S]*for share/,
    );
    expect(audienceSql).toMatch(/s\.app_id\s*=\s*configured_app_id/);
  });

  it("invalidates old-App registry rows immediately when the global App ID rotates", () => {
    expect(configSql).toMatch(
      /delete from private\.onesignal_admin_push_subscriptions/,
    );
    expect(configSql).toMatch(/app_id\s+is distinct from\s+app/);
  });

  it("sends the initialized SDK App ID with the reconciliation RPC", () => {
    expect(oneSignalSource).toMatch(
      /visionfood_reconcile_admin_push_subscription[\s\S]*_app_id:\s*initializedAppId/,
    );
  });
});
