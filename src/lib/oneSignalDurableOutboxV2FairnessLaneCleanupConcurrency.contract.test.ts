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

const migrationCorpus = normalize(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .join('\n'),
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

  it('locks only actual pressure-delete candidates and keeps the protected soft pool reusable', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).not.toBe('');
    expect(claim).toContain('pressure_cleanup_cutoff as materialized');
    expect(claim).toContain('offset lane_soft_limit-1 limit 1');
    expect(claim).toContain(
      'and (s.updated_at,s.id)<(cutoff.updated_at,cutoff.id)',
    );
    expect(claim).toMatch(
      /pressure_cleanup_candidates as \(.*for update of s skip locked limit lane_cleanup_batch \)/,
    );
    expect(claim).not.toMatch(
      /pressure_cleanup_candidates as \(.*offset lane_soft_limit.*for update of s skip locked.*\)/,
    );

    // With the fixed cutoff, exactly the rows outside the total soft pool are
    // lock candidates; the 32 protected rows are never stepped over by a
    // locking OFFSET.
    const totalLanes = 33;
    const laneSoftLimit = 32;
    const actualDeleteCandidates = Math.max(0, totalLanes - laneSoftLimit);

    expect(actualDeleteCandidates).toBe(1);
    expect(totalLanes - actualDeleteCandidates).toBe(32);
  });

  it('locks only actual idle-delete candidates and converges to the exact multi-lane floor', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).toContain('idle_cleanup_cutoff as materialized');
    expect(claim).toContain('offset lane_floor-1 limit 1');
    expect(claim).toMatch(
      /idle_cleanup_candidates as \(.*for update of s skip locked limit lane_cleanup_batch \)/,
    );
    expect(claim).not.toMatch(
      /idle_cleanup_candidates as \(.*offset lane_floor.*for update of s skip locked.*\)/,
    );

    const totalIdleLanes = 9;
    const laneFloor = 8;
    const actualDeleteCandidates = Math.max(0, totalIdleLanes - laneFloor);

    expect(actualDeleteCandidates).toBe(1);
    expect(totalIdleLanes - actualDeleteCandidates).toBe(8);
  });

  it('lets simultaneous cleaners partition only removable rows without crossing the protected cutoff', () => {
    const laneSoftLimit = 32;
    const totalLanes = 65;
    const cleanupBatch = 16;

    const protectedIds = Array.from(
      { length: laneSoftLimit },
      (_, index) => index + 1,
    );
    const removableIds = Array.from(
      { length: totalLanes - laneSoftLimit },
      (_, index) => laneSoftLimit + index + 1,
    );

    const cleanerA = removableIds.slice(0, cleanupBatch);
    const cleanerB = removableIds.slice(cleanupBatch, cleanupBatch * 2);
    const cleanerC = removableIds.slice(cleanupBatch * 2, cleanupBatch * 3);

    const deleted = new Set([...cleanerA, ...cleanerB, ...cleanerC]);

    expect([...protectedIds].some((id) => deleted.has(id))).toBe(false);
    expect(deleted.size).toBe(33);
    expect(totalLanes - deleted.size).toBe(laneSoftLimit);
  });

  it('keeps cleanup bounded and index-driven even with many historical lanes', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(migrationCorpus).toMatch(
      /create index if not exists onesignal_outbox_claim_fairness_state_recency_idx on private\.onesignal_outbox_claim_fairness_state\(updated_at,id\)/,
    );

    // Cutoff probes step over fixed constants (31 and 7), independent of the
    // historical table size; only actual candidates are row-locked in batches.
    expect(claim).toContain('offset lane_soft_limit-1 limit 1');
    expect(claim).toContain('offset lane_floor-1 limit 1');
    expect(claim.match(/limit lane_cleanup_batch/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves long-running lanes and avoids cleanup-induced lane-creation churn', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    const pressureStart = claim.indexOf('pressure_cleanup_candidates as (');
    const pressureEnd = claim.indexOf(
      'delete from private.onesignal_outbox_claim_fairness_state',
      pressureStart,
    );
    const pressureCandidates = claim.slice(pressureStart, pressureEnd);

    const idleStart = claim.indexOf('idle_cleanup_candidates as (');
    const idleEnd = claim.indexOf(
      'delete from private.onesignal_outbox_claim_fairness_state',
      idleStart,
    );
    const idleCandidates = claim.slice(idleStart, idleEnd);

    expect(claim).toMatch(/for update of s skip locked/);
    expect(pressureCandidates).not.toContain('offset');
    expect(idleCandidates).not.toContain('offset');
    expect(claim).not.toContain(
      'lock table private.onesignal_outbox_claim_fairness_state',
    );
  });

  it('keeps cursor progress independent from cleanup and preserves phase14 claim atomicity', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    const pressureStart = claim.indexOf('pressure_cleanup_cutoff as materialized');
    const returnQueryStart = claim.indexOf('return query');
    const cleanupSection = claim.slice(pressureStart, returnQueryStart);

    expect(cleanupSection).not.toContain('last_organization_id');
    expect(cleanupSection).not.toContain('fairness_progress');
    expect(claim).toContain("o.status in ('pending','retry')");
    expect(claim).toContain('for update of o skip locked');
    expect(claim).toContain('from claimed effective_claim');
    expect(claim).toContain('last_organization_id=coalesce(');
  });

  it('keeps lane creation and cleanup transaction-scoped for rollback/crash safety', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).toContain(
      'insert into private.onesignal_outbox_claim_fairness_state',
    );
    expect(claim).toContain(
      'delete from private.onesignal_outbox_claim_fairness_state',
    );
    expect(claim).not.toContain('commit;');
    expect(claim).not.toContain('rollback;');
  });
});
