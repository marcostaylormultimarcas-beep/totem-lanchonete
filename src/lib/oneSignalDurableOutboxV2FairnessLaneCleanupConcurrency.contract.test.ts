import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort();

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');

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

const phase15 = normalize(
  readFileSync(
    join(
      migrationsDir,
      '20261001163000_visionfood_v2_onesignal_durable_outbox_fairness_lane_lifecycle_phase15.sql',
    ),
    'utf8',
  ),
);

describe('OneSignal Durable Outbox V2 phase 16 fairness lane cleanup concurrency', () => {
  it('reproduces phase15 lock amplification at the soft-pool boundary', () => {
    expect(phase15).toMatch(
      /pressure_cleanup_candidates as \( select s\.id .* offset lane_soft_limit for update of s skip locked \)/,
    );

    // PostgreSQL locks rows stepped over by OFFSET in a SELECT ... FOR UPDATE.
    // With 33 total lanes, the current worker already owns one lane and the
    // cleanup sees the other 32. OFFSET 32 returns zero DELETE candidates, but
    // those 32 protected rows are still row-locked until transaction end.
    const totalLanes = 33;
    const currentWorkerLaneLocks = 1;
    const rowsVisibleToCleanup = totalLanes - currentWorkerLaneLocks;
    const laneSoftLimit = 32;
    const cleanupReturnedRows = Math.max(
      0,
      rowsVisibleToCleanup - laneSoftLimit,
    );
    const cleanupOffsetRowsLocked = Math.min(
      rowsVisibleToCleanup,
      laneSoftLimit,
    );

    expect(cleanupReturnedRows).toBe(0);
    expect(cleanupOffsetRowsLocked).toBe(32);

    const lanesAvailableToAnotherWorker =
      totalLanes - currentWorkerLaneLocks - cleanupOffsetRowsLocked;

    expect(lanesAvailableToAnotherWorker).toBe(0);
  });

  it('requires pressure cleanup to lock only actual delete candidates, never the protected soft pool', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).not.toBe('');

    // RED on phase 15: OFFSET lives in the same locking SELECT, so the rows
    // skipped to preserve the soft pool are also locked.
    expect(claim).not.toMatch(
      /pressure_cleanup_candidates as \(.*offset lane_soft_limit.*for update of s skip locked.*\)/,
    );
  });

  it('requires idle cleanup to lock only actual delete candidates, never the protected floor', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    // The idle path has the same lock-amplification bug: its OFFSET rows are
    // protected from DELETE but not from row locking.
    expect(claim).not.toMatch(
      /idle_cleanup_candidates as \(.*offset lane_floor.*for update of s skip locked.*\)/,
    );
  });

  it('keeps cursor progress independent from cleanup and preserves claim eligibility', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).toContain("o.status in ('pending','retry')");
    expect(claim).toContain('for update of o skip locked');
    expect(claim).toContain('from claimed effective_claim');
    expect(claim).toContain('last_organization_id=pg_catalog.coalesce(');
    expect(claim).not.toContain(
      'lock table private.onesignal_outbox_claim_fairness_state',
    );
  });
});
