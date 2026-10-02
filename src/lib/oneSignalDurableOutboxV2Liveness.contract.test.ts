import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort();

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');

const allMigrations = normalize(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .join('\n'),
);

function latestFunctionDefinition(schema: string, name: string): string {
  const needle = `create or replace function ${schema}.${name}(`;
  let latest = '';

  for (const file of migrationFiles) {
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

  return normalize(latest);
}

const phase3 = normalize(
  readFileSync(
    join(
      migrationsDir,
      '20260930101200_visionfood_v2_onesignal_durable_outbox_phase3.sql',
    ),
    'utf8',
  ),
);

const deliverySql = latestFunctionDefinition(
  'public',
  'visionfood_push_delivery_trigger',
);
const ruptureSql = latestFunctionDefinition(
  'public',
  'visionfood_push_rupture_trigger',
);
const predictiveSql = latestFunctionDefinition(
  'public',
  'visionfood_push_predictive_stock',
);

describe('OneSignal Durable Outbox V2 phase 8 operational liveness', () => {
  it('proves leases alone do not create an autonomous wake-up after cutover', () => {
    expect(phase3).toContain(
      'and o.lease_expires_at<=pg_catalog.clock_timestamp()',
    );
    expect(phase3).toContain("'response_missing'");
    expect(phase3).toContain("else 'retry'");

    expect(deliverySql).toContain(
      'private.visionfood_onesignal_outbox_dispatch_one(',
    );
    expect(ruptureSql).toContain(
      'private.visionfood_onesignal_outbox_dispatch_one(',
    );
    expect(deliverySql).not.toContain(
      'private.visionfood_onesignal_outbox_reconcile(',
    );
    expect(ruptureSql).not.toContain(
      'private.visionfood_onesignal_outbox_reconcile(',
    );

    // Predictive can reconcile only when its public RPC is called again.
    expect(predictiveSql).toContain(
      'private.visionfood_onesignal_outbox_reconcile(',
    );

    // After full cutover there must also be an event-independent wake-up.
    expect(allMigrations).toContain(
      'create or replace function private.visionfood_onesignal_outbox_run_once(',
    );
    expect(allMigrations).toContain(
      "'visionfood-onesignal-outbox-v2'",
    );
  });

  it('requires the operational tick to serialize, reconcile expired leases, then dispatch due backlog', () => {
    const runner = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_run_once',
    );

    expect(runner).not.toBe('');
    expect(runner).toContain('pg_try_advisory_xact_lock');
    expect(runner).toContain('visionfood:onesignal_outbox_v2_runner');

    const reconcileAt = runner.indexOf(
      'private.visionfood_onesignal_outbox_reconcile(',
    );
    const dispatchAt = runner.indexOf(
      'private.visionfood_onesignal_outbox_dispatch(',
    );

    expect(reconcileAt).toBeGreaterThanOrEqual(0);
    expect(dispatchAt).toBeGreaterThan(reconcileAt);
    expect(runner).toContain("'reconciled'");
    expect(runner).toContain("'dispatched'");
  });

  it('requires a recurring pg_cron job so pending/retry rows cannot depend on a future producer event', () => {
    expect(allMigrations).toContain('create extension if not exists pg_cron');
    expect(allMigrations).toContain('cron.unschedule(');
    expect(allMigrations).toContain('cron.schedule(');
    expect(allMigrations).toContain("'15 seconds'");
    expect(allMigrations).toContain(
      'select private.visionfood_onesignal_outbox_run_once()',
    );
  });
});
