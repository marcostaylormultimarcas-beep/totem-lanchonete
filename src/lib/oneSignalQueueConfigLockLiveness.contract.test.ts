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

describe('OneSignal queue configuration-lock liveness contract', () => {
  it('does not retain a configuration row lock through the enqueue transaction', () => {
    const queue = normalize(queueSql);

    expect(queue).not.toMatch(/for\s+share/);
    expect(queue).not.toMatch(/for\s+update/);
  });

  it('keeps App ID and API key atomic with one MVCC statement snapshot', () => {
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

  it('keeps configuration rotation ordered config -> Vault -> registry', () => {
    const config = normalize(configSql);
    const configLockAt = config.indexOf('for update');
    const vaultWriteAt = config.indexOf('vault.create_secret');
    const generationWriteAt = config.indexOf(
      'insert into private.onesignal_config_generations',
    );
    const registryDeleteAt = config.indexOf(
      'delete from private.onesignal_admin_push_subscriptions',
    );

    expect(configLockAt).toBeGreaterThanOrEqual(0);
    expect(vaultWriteAt).toBeGreaterThan(configLockAt);
    expect(generationWriteAt).toBeGreaterThan(vaultWriteAt);
    expect(registryDeleteAt).toBeGreaterThan(generationWriteAt);
  });

  it('keeps migrated delivery and rupture free of an extra configuration pre-lock', () => {
    for (const sql of [deliverySql, ruptureSql]) {
      expect(sql).toContain('private.visionfood_onesignal_outbox_enqueue(');
      expect(sql).toContain('private.visionfood_onesignal_outbox_dispatch_one(');
      expect(sql).not.toContain('public.visionfood_onesignal_queue(');
      expect(sql).not.toContain('private.onesignal_settings');
    }
  });
});
