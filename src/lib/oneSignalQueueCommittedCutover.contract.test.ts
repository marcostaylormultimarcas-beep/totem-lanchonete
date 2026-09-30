import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

function latestFunctionDefinition(schema: string, name: string): string {
  const needle = `create or replace function ${schema}.${name}(`;
  let latest: string | null = null;

  for (const file of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const lowerSql = sql.toLowerCase();
    const start = lowerSql.lastIndexOf(needle.toLowerCase());
    if (start < 0) continue;

    const nextFunction = lowerSql.indexOf(
      '\ncreate or replace function ',
      start + needle.length,
    );

    latest = sql.slice(start, nextFunction >= 0 ? nextFunction : sql.length);
  }

  if (!latest) throw new Error(`Function ${schema}.${name} was not found in migrations`);
  return latest;
}

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
const configSql = normalize(latestFunctionDefinition('public', 'set_onesignal_config'));

describe('OneSignal committed pg_net request cutover contract', () => {
  it('checks the committed pg_net queue before publishing a credential cutover', () => {
    const generationGuardAt = configSql.indexOf('pg_try_advisory_xact_lock(');
    const requestQueueAt = configSql.indexOf('net.http_request_queue');
    const vaultUpdateAt = configSql.indexOf('vault.update_secret(');
    const configWriteAt = configSql.indexOf('insert into private.onesignal_settings');

    expect(generationGuardAt).toBeGreaterThanOrEqual(0);
    expect(requestQueueAt).toBeGreaterThan(generationGuardAt);
    expect(vaultUpdateAt).toBeGreaterThan(requestQueueAt);
    expect(configWriteAt).toBeGreaterThan(requestQueueAt);
  });

  it('scopes the drain barrier to OneSignal requests from the previous App ID', () => {
    expect(configSql).toContain('https://api.onesignal.com/notifications');
    expect(configSql).toContain('previous_app_id');
    expect(configSql).toMatch(/convert_from\([^)]*q\.body[^)]*utf8[^)]*\)/);
    expect(configSql).toMatch(/app_id/);
  });

  it('fails the rotation closed while a remaining old-generation row is unsafe', () => {
    expect(configSql).toContain('remaining_old_requests');
    expect(configSql).toContain('has_unowned_old_request');
    expect(configSql).toContain('has_live_old_request');
    expect(configSql).toMatch(
      /if\s+remaining_old_requests>0\s+and\s+\(\s*has_unowned_old_request\s+or\s+has_live_old_request\s*\)\s+then\s+return\s+jsonb_build_object\('ok',false,'reason','config_busy'\)/,
    );
  });
});
