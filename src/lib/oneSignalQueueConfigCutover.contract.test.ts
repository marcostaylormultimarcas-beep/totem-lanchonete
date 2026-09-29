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
const generationGuardPattern =
  /hashtextextended\(\s*'visionfood:onesignal_config'\s*,\s*0\s*\)/;

const queueSql = latestFunctionDefinition('public', 'visionfood_onesignal_queue');
const configSql = latestFunctionDefinition('public', 'set_onesignal_config');

describe('OneSignal queue configuration cutover contract', () => {
  it('keeps a transaction-scoped shared generation guard from snapshot through caller commit', () => {
    const queue = normalize(queueSql);
    const guardAt = queue.indexOf('pg_advisory_xact_lock_shared');
    const settingsAt = queue.indexOf('from private.onesignal_settings');

    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(settingsAt).toBeGreaterThan(guardAt);
    expect(queue).toMatch(generationGuardPattern);
  });

  it('keeps rotation lock order config row -> generation guard and fails fast on an older direct queue', () => {
    const config = normalize(configSql);
    const configRowLockAt = config.indexOf('for update');
    const tryGuardAt = config.indexOf('pg_try_advisory_xact_lock(');

    expect(configRowLockAt).toBeGreaterThanOrEqual(0);
    expect(tryGuardAt).toBeGreaterThan(configRowLockAt);
    expect(config).toMatch(generationGuardPattern);
    expect(config).toContain("'config_busy'");
  });

  it('does not reintroduce a settings-row lock in the queue', () => {
    const queue = normalize(queueSql);

    expect(queue).not.toMatch(/private\.onesignal_settings[^;]*for\s+share/);
    expect(queue).not.toMatch(/private\.onesignal_settings[^;]*for\s+update/);
  });
});
