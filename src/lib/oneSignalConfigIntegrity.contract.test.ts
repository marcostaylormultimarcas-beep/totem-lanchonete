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
  join(root, "src", "components", "admin", "OneSignalPanel.tsx"),
  "utf8",
);

const validatorSource = readFileSync(
  join(root, "supabase", "functions", "onesignal-validate", "index.ts"),
  "utf8",
);

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

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ");
const configSql = normalize(latestFunctionDefinition("set_onesignal_config").sql);

describe("OneSignal configuration integrity contract", () => {
  it("validates a supplied API key before mutating private.onesignal_settings", () => {
    const validation = configSql.indexOf("invalid_api_key");
    const mutation = configSql.indexOf("insert into private.onesignal_settings");

    expect(validation).toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(mutation);
  });

  it("locks and reads the current global configuration before deciding whether an App ID change is safe", () => {
    const lockedRead = configSql.indexOf("from private.onesignal_settings where id='global' for update");
    const mutation = configSql.indexOf("insert into private.onesignal_settings");

    expect(lockedRead).toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(-1);
    expect(lockedRead).toBeLessThan(mutation);
  });

  it("requires a fresh API key when enabling or changing to a different non-empty App ID", () => {
    expect(configSql).toContain("api_key_required_for_app_change");
    expect(configSql).toMatch(/app\s+is\s+distinct\s+from\s+coalesce\(c\.app_id,''\)/);
  });

  it("does not silently accept a configured App ID whose stored API key is missing from Vault", () => {
    expect(configSql).toContain("api_key_required");
    expect(configSql).toMatch(/exists\(\s*select 1 from vault\.secrets/);
  });

  it("keeps secret rotation server-side without mutating the previous Vault credential", () => {
    expect(configSql).not.toContain("vault.update_secret");
    expect(configSql).toContain("vault.create_secret");
    expect(configSql).toContain("insert into private.onesignal_config_generations");
    expect(configSql).toContain("config_generation_id=excluded.config_generation_id");
    expect(configSql).toContain("'has_api_key'");
    expect(configSql).not.toContain("'api_key',key");
  });

  it("surfaces the App ID/key mismatch to the Super Admin instead of showing a generic save failure", () => {
    expect(panelSource).toContain("api_key_required_for_app_change");
    expect(panelSource).toContain("api_key_required");
    expect(panelSource).toContain("credential_mismatch");
    expect(panelSource).toContain("A App API Key não pertence a este App ID.");
  });

  it("validates the App ID and App API Key pair remotely before persisting a supplied key", () => {
    expect(validatorSource).toContain("Authorization: `Key ${apiKey}`");
    expect(validatorSource).toContain("validationResponse.status !== 200");

    const validationGuard = validatorSource.indexOf(
      "if (validationResponse.status !== 200)",
    );
    const validatedPersist = validatorSource.lastIndexOf(
      "admin.rpc('set_onesignal_config'",
    );

    expect(validationGuard).toBeGreaterThan(-1);
    expect(validatedPersist).toBeGreaterThan(validationGuard);
  });

  it("fails closed when OneSignal credential validation is unavailable or rejected", () => {
    expect(validatorSource).toContain("validation_unavailable");
    expect(validatorSource).toContain("credential_mismatch");
    expect(validatorSource).toContain("credential_validation_failed");
  });

  it("routes browser configuration writes through the credential validator instead of calling set_onesignal_config directly", () => {
    expect(panelSource).toContain("supabase.functions.invoke('onesignal-validate'");
    expect(panelSource).not.toContain("supabase.rpc('set_onesignal_config'");
  });

  it("does not grant authenticated browsers a direct bypass around App ID/API key validation", () => {
    expect(configSql).not.toMatch(/grant execute[\s\S]*to authenticated/);
    expect(configSql).toMatch(/grant execute[\s\S]*to service_role/);
  });
});
