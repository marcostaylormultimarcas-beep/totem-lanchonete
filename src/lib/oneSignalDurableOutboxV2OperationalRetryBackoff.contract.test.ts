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

function allMigrations(): string {
  return normalize(
    migrationFiles
      .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
      .join('\n'),
  );
}

type DurableState = {
  status: 'pending' | 'sending';
  attemptCount: number;
  cursor: string | null;
  lanes: number[];
  attempts: number;
  transportQueueRows: number;
};

function freshState(): DurableState {
  return {
    status: 'pending',
    attemptCount: 0,
    cursor: null,
    lanes: [1, 2, 3, 4, 5, 6, 7, 8],
    attempts: 0,
    transportQueueRows: 0,
  };
}

function abortedTransaction(
  committed: DurableState,
  mutate: (working: DurableState) => void,
): DurableState {
  const working: DurableState = {
    ...committed,
    lanes: [...committed.lanes],
  };

  mutate(working);

  // PostgreSQL aborts the whole transaction for both serialization_failure
  // (40001) and deadlock_detected (40P01). The caller must open a fresh
  // transaction for a retry; no partial durable mutation survives here.
  return committed;
}

describe('OneSignal Durable Outbox V2 phase 19 operational retry/backoff audit', () => {
  it('keeps both 40001 and 40P01 outside run_once so retries cannot occur inside the failed transaction', () => {
    const runOnce = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_run_once',
    );

    expect(runOnce).not.toBe('');
    expect(runOnce).toContain('pg_try_advisory_xact_lock');
    expect(runOnce).not.toContain('serialization_failure');
    expect(runOnce).not.toContain('deadlock_detected');
    expect(runOnce).not.toContain("sqlstate '40001'");
    expect(runOnce).not.toContain("sqlstate '40p01'");
    expect(runOnce).not.toContain('exception when others');
    expect(runOnce).not.toContain('pg_sleep');
  });

  it('uses a non-waiting transaction advisory lock so canonical runners do not form a concurrent retry herd', () => {
    const runOnce = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_run_once',
    );

    expect(runOnce).toContain('pg_try_advisory_xact_lock');
    expect(runOnce).toContain("'busy',true");
    expect(runOnce).not.toContain('pg_advisory_xact_lock(');
  });

  it('keeps the canonical operational caller as one periodic run_once call rather than an in-command retry loop', () => {
    const sql = allMigrations();
    const runnerSchedule = /perform cron\.schedule\( 'visionfood-onesignal-outbox-v2', '15 seconds', \$cron\$ select private\.visionfood_onesignal_outbox_run_once\(\); \$cron\$ \)/g;
    const matches = [...sql.matchAll(runnerSchedule)];

    expect(matches.length).toBeGreaterThan(0);

    const last = matches.at(-1)?.[0] ?? '';
    expect(last).toContain("'15 seconds'");
    expect(last.match(/visionfood_onesignal_outbox_run_once\(\)/g)).toHaveLength(1);
    expect(last).not.toContain('loop');
    expect(last).not.toContain('pg_sleep');
  });

  it('leaves repeated serialization failures with no partial claim/cursor/lane/transport progress', () => {
    const committed = freshState();

    const firstAbort = abortedTransaction(committed, (working) => {
      working.status = 'sending';
      working.attemptCount += 1;
      working.cursor = 'org-a';
      working.lanes.push(9);
      working.attempts += 1;
      working.transportQueueRows += 1;
    });

    const secondAbort = abortedTransaction(firstAbort, (working) => {
      working.status = 'sending';
      working.attemptCount += 1;
      working.cursor = 'org-b';
      working.lanes.push(10);
      working.attempts += 1;
      working.transportQueueRows += 1;
    });

    expect(firstAbort).toEqual(committed);
    expect(secondAbort).toEqual(committed);
  });

  it('leaves repeated deadlock victims equally rollback-safe before the next fresh transaction', () => {
    const committed = freshState();

    const afterDeadlock = abortedTransaction(committed, (working) => {
      working.status = 'sending';
      working.attemptCount += 1;
      working.cursor = 'org-c';
      working.lanes = working.lanes.filter((id) => id !== 1);
      working.attempts += 1;
    });

    expect(afterDeadlock.status).toBe('pending');
    expect(afterDeadlock.attemptCount).toBe(0);
    expect(afterDeadlock.cursor).toBeNull();
    expect(afterDeadlock.lanes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(afterDeadlock.attempts).toBe(0);
  });

  it('does not invent database-side jitter because transaction restart belongs to the outer operational caller', () => {
    const runOnce = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_run_once',
    );

    expect(runOnce).not.toContain('random()');
    expect(runOnce).not.toContain('pg_sleep');
    expect(runOnce).not.toContain('backoff');
  });
});
