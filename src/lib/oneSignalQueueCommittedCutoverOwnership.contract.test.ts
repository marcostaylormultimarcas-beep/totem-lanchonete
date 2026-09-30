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

describe('OneSignal committed pg_net row ownership contract', () => {
  it('binds the locked OneSignal queue row to the exact pg_net worker transaction', () => {
    expect(configSql).toContain('backend_xid');
    expect(configSql).toContain('xmax');
    expect(configSql).toMatch(/backend_xid\s*=\s*q\.xmax|q\.xmax\s*=\s*a\.backend_xid/);
  });

  it('does not infer ownership from an unrelated pg_net transaction in a mixed batch', () => {
    const workerActivityAt = configSql.indexOf('pg_catalog.pg_stat_activity');
    const ownerJoinAt = Math.max(
      configSql.indexOf('a.backend_xid=q.xmax'),
      configSql.indexOf('q.xmax=a.backend_xid'),
    );
    const oneSignalScopeAt = configSql.indexOf(
      "q.url='https://api.onesignal.com/notifications'",
    );

    expect(workerActivityAt).toBeGreaterThanOrEqual(0);
    expect(ownerJoinAt).toBeGreaterThan(workerActivityAt);
    expect(oneSignalScopeAt).toBeGreaterThanOrEqual(0);
    expect(configSql).not.toMatch(/min\s*\(\s*a\.xact_start\s*\)/);
  });

  it('fails closed when a remaining locked OneSignal row has no exact pg_net owner', () => {
    expect(configSql).toContain('has_unowned_old_request');
    expect(configSql).toMatch(
      /if\s+remaining_old_requests>0\s+and\s+\(\s*has_unowned_old_request\s+or\s+has_live_old_request\s*\)\s+then\s+return\s+jsonb_build_object\('ok',false,'reason','config_busy'\)/,
    );
  });
});
