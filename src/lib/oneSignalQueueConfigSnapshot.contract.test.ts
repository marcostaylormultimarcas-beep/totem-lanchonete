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

const queueSql = latestFunctionDefinition('public', 'visionfood_onesignal_queue');
const configSql = latestFunctionDefinition('public', 'set_onesignal_config');
const deliverySql = latestFunctionDefinition('public', 'visionfood_push_delivery_trigger');
const ruptureSql = latestFunctionDefinition('public', 'visionfood_push_rupture_trigger');

describe('OneSignal queue App ID/API key snapshot contract', () => {
  it('locks the global configuration before reading the Vault secret', () => {
    const queue = normalize(queueSql);
    const configRead = queue.indexOf(
      "from private.onesignal_settings where id='global' for share",
    );
    const vaultRead = queue.indexOf('from vault.decrypted_secrets');
    const enqueue = queue.indexOf('net.http_post');

    expect(configRead).toBeGreaterThanOrEqual(0);
    expect(vaultRead).toBeGreaterThan(configRead);
    expect(enqueue).toBeGreaterThan(vaultRead);
  });

  it('serializes the queue snapshot with configuration rotation', () => {
    const config = normalize(configSql);

    expect(config).toContain(
      "from private.onesignal_settings where id='global' for update",
    );
    expect(config).toContain('vault.update_secret');
  });

  it('protects delivery and rupture callers at the queue boundary', () => {
    expect(deliverySql).toContain('public.visionfood_onesignal_queue(');
    expect(ruptureSql).toContain('public.visionfood_onesignal_queue(');

    expect(deliverySql).not.toContain('private.onesignal_settings');
    expect(ruptureSql).not.toContain('private.onesignal_settings');
  });

  it('preserves caller targets, including include_subscription_ids', () => {
    expect(queueSql).toMatch(/\)\s*\|\|\s*_target/i);
    expect(queueSql).toContain("'app_id',c.app_id");
    expect(queueSql).toContain("'data',coalesce(_data,'{}'::jsonb)");
  });
});
