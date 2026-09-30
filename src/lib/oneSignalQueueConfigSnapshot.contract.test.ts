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
  it('reads configuration and Vault from one MVCC statement before enqueue', () => {
    const queue = normalize(queueSql);
    const settingsAt = queue.indexOf('from private.onesignal_settings');
    const vaultAt = queue.indexOf('vault.decrypted_secrets', settingsAt);
    const enqueueAt = queue.indexOf('net.http_post');

    expect(settingsAt).toBeGreaterThanOrEqual(0);
    expect(vaultAt).toBeGreaterThan(settingsAt);
    expect(enqueueAt).toBeGreaterThan(vaultAt);
    expect(queue.slice(0, enqueueAt)).toMatch(
      /from private\.onesignal_settings\s+[a-z]+\s+(?:left\s+)?join\s+vault\.decrypted_secrets\s+[a-z]+/,
    );
  });

  it('keeps configuration rotation atomic at the writer', () => {
    const config = normalize(configSql);

    expect(config).toContain(
      "from private.onesignal_settings where id='global' for update",
    );
    expect(config).not.toContain('vault.update_secret');
    expect(config).toContain('vault.create_secret');
    expect(config).toContain('insert into private.onesignal_config_generations');
    expect(config).toContain('config_generation_id=excluded.config_generation_id');
  });

  it('protects delivery and rupture callers at the queue boundary', () => {
    expect(deliverySql).toContain('public.visionfood_onesignal_queue(');
    expect(ruptureSql).toContain('public.visionfood_onesignal_queue(');

    expect(deliverySql).not.toContain('private.onesignal_settings');
    expect(ruptureSql).not.toContain('private.onesignal_settings');
  });

  it('preserves caller targets, including include_subscription_ids', () => {
    expect(queueSql).toMatch(/\)\s*\|\|\s*_target/i);
    expect(queueSql).toContain("'app_id',app_id");
    expect(queueSql).toContain("'data',coalesce(_data,'{}'::jsonb)");
  });
});
