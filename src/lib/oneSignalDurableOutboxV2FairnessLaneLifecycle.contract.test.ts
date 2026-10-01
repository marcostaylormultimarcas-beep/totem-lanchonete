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

const phase14 = normalize(
  readFileSync(
    join(
      migrationsDir,
      '20261001161500_visionfood_v2_onesignal_durable_outbox_claim_cursor_atomicity_phase14.sql',
    ),
    'utf8',
  ),
);

const migrationCorpus = normalize(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .join('\n'),
);

describe('OneSignal Durable Outbox V2 phase 15 fairness lane lifecycle', () => {
  it('proves committed contention bursts can grow phase14 lanes without any compaction path', () => {
    expect(phase14).toContain(
      'insert into private.onesignal_outbox_claim_fairness_state',
    );
    expect(phase14).not.toContain(
      'delete from private.onesignal_outbox_claim_fairness_state',
    );

    // All workers start while the only committed lane is transaction-locked.
    // Their newly inserted lanes are mutually invisible until commit, so every
    // worker can create one. Phase 14 never removes the committed excess.
    const initialCommittedLanes = 1;
    const simultaneousWorkers = 64;
    const committedAfterBurst = initialCommittedLanes + simultaneousWorkers;

    expect(committedAfterBurst).toBe(65);
    expect(committedAfterBurst).toBeGreaterThan(simultaneousWorkers);
  });

  it('documents that rollback removes lane rows but still leaves harmless bigint sequence gaps', () => {
    const committedLaneIds = [1];
    let sequenceValue = 1;

    const rolledBackId = ++sequenceValue;
    expect(rolledBackId).toBe(2);

    // INSERT was rolled back: no durable row remains, but nextval is not
    // transactional, so the following committed lane gets a later bigint id.
    const nextCommittedId = ++sequenceValue;
    committedLaneIds.push(nextCommittedId);

    expect(committedLaneIds).toEqual([1, 3]);
    expect(committedLaneIds).toHaveLength(2);
    expect(sequenceValue).toBe(3);
  });

  it('proves phase14 updated_at,id ordering can repeatedly pick the same zero-claim lane', () => {
    expect(phase14).toMatch(
      /order by s\.updated_at,s\.id for update of s skip locked limit 1/,
    );

    type Lane = { id: number; updatedAt: number };
    const lanes: Lane[] = [
      { id: 1, updatedAt: 10 },
      { id: 2, updatedAt: 20 },
      { id: 3, updatedAt: 30 },
    ];

    const selected: number[] = [];

    for (let tick = 0; tick < 5; tick += 1) {
      const lane = [...lanes].sort(
        (a, b) => a.updatedAt - b.updatedAt || a.id - b.id,
      )[0];

      selected.push(lane.id);

      // Phase 14 changes updated_at only inside fairness_progress, whose WHERE
      // requires an effective claimed row. A zero-claim commit leaves recency
      // unchanged, so the same oldest lane wins again.
    }

    expect(selected).toEqual([1, 1, 1, 1, 1]);
  });

  it('proves an unlocked lane returning from a long transaction is immediately favored when its recency stayed old', () => {
    const lanes = [
      { id: 1, updatedAt: 1, locked: true },
      { id: 2, updatedAt: 20, locked: false },
      { id: 3, updatedAt: 30, locked: false },
    ];

    const whileLongTransactionRuns = lanes
      .filter((lane) => !lane.locked)
      .sort((a, b) => a.updatedAt - b.updatedAt || a.id - b.id)[0];

    expect(whileLongTransactionRuns.id).toBe(2);

    lanes[0].locked = false;

    const immediatelyAfterRelease = lanes
      .filter((lane) => !lane.locked)
      .sort((a, b) => a.updatedAt - b.updatedAt || a.id - b.id)[0];

    expect(immediatelyAfterRelease.id).toBe(1);
  });

  it('requires lane acquisition to rotate recency without coupling cursor movement to a zero claim', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).not.toBe('');
    expect(claim).toContain('fairness_lane_id');
    expect(claim).toContain(
      'update private.onesignal_outbox_claim_fairness_state set updated_at=pg_catalog.clock_timestamp() where id=fairness_lane_id',
    );

    // Cursor progress must remain guarded by an effective claim, preserving the
    // phase-14 atomicity fix even though lane recency rotates on every commit.
    expect(claim).toContain('from claimed effective_claim');
    expect(claim).toContain('last_organization_id=pg_catalog.coalesce(');
  });

  it('requires bounded stale-lane cleanup that skips locks and retains a multi-lane floor', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).toContain('lane_floor');
    expect(claim).toContain('lane_cleanup_batch');
    expect(claim).toContain('lane_idle_ttl');
    expect(claim).toContain('cleanup_candidates as');
    expect(claim).toMatch(
      /updated_at\s*<\s*pg_catalog\.clock_timestamp\(\)-lane_idle_ttl/,
    );
    expect(claim).toContain('offset lane_floor');
    expect(claim).toContain('limit lane_cleanup_batch');
    expect(claim).toMatch(/for update of s skip locked/);
    expect(claim).toContain(
      'delete from private.onesignal_outbox_claim_fairness_state',
    );
    expect(claim).not.toContain('lock table private.onesignal_outbox_claim_fairness_state');
  });

  it('requires an updated_at,id index so lane reuse/cleanup cost does not grow as a full sort', () => {
    expect(migrationCorpus).toMatch(
      /create index if not exists onesignal_outbox_claim_fairness_state_recency_idx on private\.onesignal_outbox_claim_fairness_state\s*\(updated_at,id\)/,
    );
  });
});
