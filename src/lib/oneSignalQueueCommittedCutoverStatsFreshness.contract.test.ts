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

describe('OneSignal pg_stat_activity freshness contract', () => {
  it('opts the config function out of transaction-cached statistics', () => {
    expect(configSql).toMatch(
      /set\s+stats_fetch_consistency\s*(?:=|to)\s*'?none'?/,
    );
  });

  it('establishes fresh-stat semantics before reading pg_stat_activity', () => {
    const freshnessAt = configSql.search(
      /set\s+stats_fetch_consistency\s*(?:=|to)\s*'?none'?/,
    );
    const activityAt = configSql.indexOf('pg_catalog.pg_stat_activity');

    expect(freshnessAt).toBeGreaterThanOrEqual(0);
    expect(activityAt).toBeGreaterThan(freshnessAt);
  });

  it('does not depend on a caller transaction keeping the default cache snapshot fresh', () => {
    expect(configSql).toContain('pg_catalog.pg_stat_activity');
    expect(configSql).toMatch(
      /set\s+stats_fetch_consistency\s*(?:=|to)\s*'?none'?/,
    );
  });
});
