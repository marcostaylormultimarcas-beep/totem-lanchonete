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

const phase3 = normalize(
  readFileSync(
    join(
      migrationsDir,
      '20260930101200_visionfood_v2_onesignal_durable_outbox_phase3.sql',
    ),
    'utf8',
  ),
);

const phase7 = normalize(
  readFileSync(
    join(
      migrationsDir,
      '20260930113000_visionfood_v2_onesignal_legacy_cleanup_phase7.sql',
    ),
    'utf8',
  ),
);

const queueSql = normalize(
  latestFunctionDefinition('public', 'visionfood_onesignal_queue'),
);
const configSql = normalize(
  latestFunctionDefinition('public', 'set_onesignal_config'),
);
const predictiveSql = normalize(
  latestFunctionDefinition('public', 'visionfood_push_predictive_stock'),
);
const deliverySql = normalize(
  latestFunctionDefinition('public', 'visionfood_push_delivery_trigger'),
);
const ruptureSql = normalize(
  latestFunctionDefinition('public', 'visionfood_push_rupture_trigger'),
);

describe('OneSignal Durable Outbox V2 phase 7 legacy cleanup', () => {
  it('keeps the legacy public queue signature but makes it transport-inert', () => {
    expect(queueSql).toContain('return null;');
    expect(queueSql).not.toContain('net.http_post');
    expect(queueSql).not.toContain('private.onesignal_settings');
    expect(queueSql).not.toContain('vault.decrypted_secrets');
    expect(queueSql).not.toContain('pg_advisory');
    expect(phase7).toContain(
      'revoke all on function public.visionfood_onesignal_queue(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role',
    );
  });

  it('proves all supported producers stay on the durable outbox path', () => {
    for (const sql of [predictiveSql, deliverySql, ruptureSql]) {
      expect(sql).toContain('private.visionfood_onesignal_outbox_enqueue(');
      expect(sql).toContain('private.visionfood_onesignal_outbox_dispatch_one(');
      expect(sql).not.toContain('public.visionfood_onesignal_queue(');
      expect(sql).not.toContain('net.http_request_queue');
    }
  });

  it('removes obsolete pg_net queue/activity cutover guards from config rotation', () => {
    expect(configSql).not.toContain('net.http_request_queue');
    expect(configSql).not.toContain('pg_catalog.pg_stat_activity');
    expect(configSql).not.toContain('backend_xid');
    expect(configSql).not.toContain('q.xmax');
    expect(configSql).not.toContain('pg_try_advisory_xact_lock');
    expect(configSql).not.toContain('pg_advisory_xact_lock');
    expect(configSql).not.toContain('visionfood:onesignal_config');
    expect(configSql).not.toContain('stats_fetch_consistency');
    expect(configSql).not.toContain("'config_busy'");
  });

  it('preserves serialized live-pointer writes and immutable generation rotation', () => {
    const rowLockAt = configSql.indexOf(
      "from private.onesignal_settings where id='global' for update",
    );
    const vaultCreateAt = configSql.indexOf('vault.create_secret(');
    const generationWriteAt = configSql.indexOf(
      'insert into private.onesignal_config_generations',
    );
    const settingsWriteAt = configSql.indexOf(
      'insert into private.onesignal_settings',
    );

    expect(rowLockAt).toBeGreaterThanOrEqual(0);
    expect(vaultCreateAt).toBeGreaterThan(rowLockAt);
    expect(generationWriteAt).toBeGreaterThan(vaultCreateAt);
    expect(settingsWriteAt).toBeGreaterThan(generationWriteAt);
    expect(configSql).toContain('generation_id:=gen_random_uuid()');
    expect(configSql).not.toContain('vault.update_secret');
    expect(configSql).not.toContain('delete from vault.secrets');
  });

  it('preserves validation and the public set-config response contract', () => {
    expect(configSql).toContain("'invalid_app_id'");
    expect(configSql).toContain("'invalid_api_key'");
    expect(configSql).toContain("'app_id_required_for_api_key'");
    expect(configSql).toContain("'api_key_required_for_app_change'");
    expect(configSql).toContain("'api_key_required'");
    expect(configSql).toContain("'config_generation_missing'");
    expect(configSql).toContain("'ok',true");
    expect(configSql).toContain("'app_id',app");
    expect(configSql).toContain("'has_api_key',has_key");
  });

  it('keeps pg_net only inside the durable transport/reconciliation runtime', () => {
    expect(phase3).toContain("url:='https://api.onesignal.com/notifications'");
    expect(phase3).toContain('select net.http_post(');
    expect(phase3).toContain('from net._http_response r');
    expect(phase3).not.toContain('net.http_request_queue');
    expect(phase3).not.toContain('pg_catalog.pg_stat_activity');
    expect(phase3).not.toContain('backend_xid');
    expect(phase3).not.toContain('q.xmax');
  });
});
