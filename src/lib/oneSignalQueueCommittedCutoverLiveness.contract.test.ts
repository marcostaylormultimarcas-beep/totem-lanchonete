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

describe('OneSignal committed pg_net drain barrier liveness contract', () => {
  it('cancels old-generation requests that are still queued and not owned by the worker', () => {
    const cleanupAt = configSql.indexOf('for update skip locked');
    const barrierAt = configSql.lastIndexOf("'config_busy'");

    expect(cleanupAt).toBeGreaterThanOrEqual(0);
    expect(configSql).toContain('delete from net.http_request_queue');
    expect(cleanupAt).toBeLessThan(barrierAt);
  });

  it('bounds the in-flight barrier using the pg_net worker transaction age and request timeout', () => {
    expect(configSql).toContain('pg_stat_activity');
    expect(configSql).toContain('xact_start');
    expect(configSql).toContain('timeout_milliseconds');
    expect(configSql).toMatch(/clock_timestamp\(\)/);
  });

  it('does not require a timestamp column that pg_net http_request_queue does not provide', () => {
    expect(configSql).not.toMatch(/q\.(created|created_at|queued_at)/);
  });
});
