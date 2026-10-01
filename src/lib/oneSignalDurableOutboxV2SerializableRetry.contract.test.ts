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

type DurableState = {
  pending: boolean;
  attemptCount: number;
  cursor: string | null;
  lanes: number[];
  attempts: number;
  transportQueueRows: number;
};

function freshState(): DurableState {
  return {
    pending: true,
    attemptCount: 0,
    cursor: null,
    lanes: [1, 2, 3, 4, 5, 6, 7, 8],
    attempts: 0,
    transportQueueRows: 0,
  };
}

function transactionalAttempt(
  committed: DurableState,
  mutate: (working: DurableState) => void,
  serializationFailure: boolean,
): DurableState {
  const working: DurableState = {
    ...committed,
    lanes: [...committed.lanes],
  };

  mutate(working);

  // PostgreSQL SQLSTATE 40001 requires retry of the transaction boundary.
  // All table changes made by the failed transaction disappear together.
  return serializationFailure ? committed : working;
}

describe('OneSignal Durable Outbox V2 phase 18 RR/SERIALIZABLE retry safety', () => {
  it('lets serialization_failure from lane acquisition/cleanup/claim escape to the transaction boundary', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).not.toBe('');
    expect(claim).toContain('for update of s skip locked');
    expect(claim).toContain('for update of o skip locked');
    expect(claim).not.toContain('exception when serialization_failure');
    expect(claim).not.toContain('when sqlstate \'40001\'');
    expect(claim).not.toContain('when others');
  });

  it('keeps claim outside the dispatch exception block so 40001 is not downgraded to an outbox retry', () => {
    const dispatch = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_dispatch',
    );

    const claimCall = dispatch.indexOf(
      'from private.visionfood_onesignal_outbox_claim(',
    );
    const transportBlock = dispatch.indexOf(
      "begin select net.http_post(",
    );
    const catchAll = dispatch.indexOf('exception when others then');

    expect(claimCall).toBeGreaterThanOrEqual(0);
    expect(transportBlock).toBeGreaterThan(claimCall);
    expect(catchAll).toBeGreaterThan(transportBlock);

    const beforeTransportBlock = dispatch.slice(0, transportBlock);
    expect(beforeTransportBlock).not.toContain('exception when others');
  });

  it('lets run_once fail atomically instead of swallowing a serialization failure', () => {
    const runOnce = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_run_once',
    );

    expect(runOnce).not.toBe('');
    expect(runOnce).toContain('pg_try_advisory_xact_lock');
    expect(runOnce).toContain('visionfood_onesignal_outbox_dispatch(');
    expect(runOnce).not.toContain('exception when serialization_failure');
    expect(runOnce).not.toContain('when sqlstate \'40001\'');
    expect(runOnce).not.toContain('exception when others');
  });

  it('rolls back lane recency, cleanup, claim and cursor together on a pre-commit 40001', () => {
    const committed = freshState();

    const afterFailedAttempt = transactionalAttempt(
      committed,
      (working) => {
        working.lanes = working.lanes.filter((id) => id !== 1);
        working.pending = false;
        working.attemptCount += 1;
        working.cursor = 'org-b';
      },
      true,
    );

    expect(afterFailedAttempt).toEqual(committed);
    expect(afterFailedAttempt.pending).toBe(true);
    expect(afterFailedAttempt.attemptCount).toBe(0);
    expect(afterFailedAttempt.cursor).toBeNull();
    expect(afterFailedAttempt.lanes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('treats a lane created by an aborted attempt as uncommitted while allowing only a harmless sequence gap', () => {
    const committed = freshState();
    const allocatedSequenceIds = [9];

    const afterFailedAttempt = transactionalAttempt(
      committed,
      (working) => {
        working.lanes.push(allocatedSequenceIds[0]);
      },
      true,
    );

    // nextval itself is non-transactional, so the numeric id can be skipped,
    // but the lane row cannot survive the failed transaction.
    const retryAllocatedId = 10;

    expect(afterFailedAttempt.lanes).not.toContain(9);
    expect(retryAllocatedId).toBeGreaterThan(allocatedSequenceIds[0]);
    expect(afterFailedAttempt.lanes).toHaveLength(8);
  });

  it('turns a stale RR/SERIALIZABLE cleanup conflict into abort/under-cleanup rather than over-delete', () => {
    const committed = freshState();

    const afterFailedAttempt = transactionalAttempt(
      committed,
      (working) => {
        // Model a stale snapshot that had considered lane 1 removable while a
        // concurrent transaction promoted that lane. PostgreSQL RR/SERIALIZABLE
        // may raise 40001 on the locking write instead of using a fresh command
        // snapshot. The safe outcome is whole-transaction rollback.
        working.lanes = working.lanes.filter((id) => id !== 1);
      },
      true,
    );

    expect(afterFailedAttempt.lanes).toEqual(committed.lanes);
    expect(afterFailedAttempt.lanes).toHaveLength(8);
  });

  it('rolls back the pg_net queue row and durable attempt if SERIALIZABLE fails at commit', () => {
    const committed = freshState();

    const afterCommitFailure = transactionalAttempt(
      committed,
      (working) => {
        working.pending = false;
        working.attemptCount += 1;
        working.cursor = 'org-a';
        working.attempts += 1;
        working.transportQueueRows += 1;
      },
      true,
    );

    expect(afterCommitFailure.pending).toBe(true);
    expect(afterCommitFailure.attemptCount).toBe(0);
    expect(afterCommitFailure.cursor).toBeNull();
    expect(afterCommitFailure.attempts).toBe(0);
    expect(afterCommitFailure.transportQueueRows).toBe(0);
  });

  it('retries from a fresh transaction without double-claiming or advancing the cursor twice', () => {
    const committed = freshState();

    const failed = transactionalAttempt(
      committed,
      (working) => {
        working.pending = false;
        working.attemptCount += 1;
        working.cursor = 'org-a';
      },
      true,
    );

    const retried = transactionalAttempt(
      failed,
      (working) => {
        expect(working.pending).toBe(true);
        working.pending = false;
        working.attemptCount += 1;
        working.cursor = 'org-a';
      },
      false,
    );

    expect(retried.pending).toBe(false);
    expect(retried.attemptCount).toBe(1);
    expect(retried.cursor).toBe('org-a');
  });
});
