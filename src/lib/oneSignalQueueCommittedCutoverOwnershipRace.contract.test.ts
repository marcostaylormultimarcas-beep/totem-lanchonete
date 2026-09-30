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

describe('OneSignal pg_net ownership snapshot race contract', () => {
  it('derives the exact pg_net owner and that row timeout in the same SQL statement', () => {
    const classificationAt = configSql.indexOf('select pg_catalog.count(*)');
    const classificationEnd = configSql.indexOf(';', classificationAt);
    const classificationSql = configSql.slice(classificationAt, classificationEnd);

    expect(classificationAt).toBeGreaterThanOrEqual(0);
    expect(classificationSql).toMatch(/a\.backend_xid\s*=\s*q\.xmax|q\.xmax\s*=\s*a\.backend_xid/);
    expect(classificationSql).toContain('q.timeout_milliseconds');
  });

  it('does not rescan the queue by a worker xid captured by an earlier statement', () => {
    expect(configSql).not.toMatch(/where\s+q\.xmax\s*=\s*worker_xid/);
  });

  it('does not gate owner resolution behind a prior queue EXISTS snapshot', () => {
    const remainingExistsAt = configSql.indexOf('if exists(');
    const ownerJoinAt = Math.max(
      configSql.indexOf('a.backend_xid=q.xmax'),
      configSql.indexOf('q.xmax=a.backend_xid'),
    );

    expect(ownerJoinAt).toBeGreaterThanOrEqual(0);
    expect(remainingExistsAt).toBeLessThan(0);
  });
});
