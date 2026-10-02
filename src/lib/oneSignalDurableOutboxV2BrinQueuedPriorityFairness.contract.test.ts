import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const phase10 = readFileSync(
  'supabase/migrations/20261001150000_visionfood_v2_onesignal_durable_outbox_observability_backpressure_phase10.sql',
  'utf8',
);
const phase9 = readFileSync(
  'supabase/migrations/20260930155000_visionfood_v2_onesignal_durable_outbox_retention_phase9.sql',
  'utf8',
);

const cleanup = phase10.slice(
  phase10.indexOf('create or replace function private.visionfood_onesignal_outbox_cleanup('),
  phase10.indexOf('create or replace function private.visionfood_onesignal_outbox_health('),
);

const QUEUED_START_BUCKETS = [2, 2, 2, 2, 4, 4, 4, 4];

function firstForWallClockBucket(bucket: number): 0 | 1 {
  return bucket % 2 === 0 ? 0 : 1;
}

function firstForExecutionSequence(execution: number): 0 | 1 {
  return execution % 2 === 0 ? 0 : 1;
}

function opportunities(firstIndexes: Array<0 | 1>) {
  const result = [0, 0];

  for (const first of firstIndexes) {
    result[first] += 1;
  }

  return result;
}

describe('Durable Outbox V2 phase 37 queued cleanup BRIN priority fairness', () => {
  it('does not derive first-index priority from delayed wall-clock bucket parity', () => {
    expect(phase9).toContain("'*/10 * * * *'");

    const wallClockFirst = QUEUED_START_BUCKETS.map(firstForWallClockBucket);
    const sequenceFirst = QUEUED_START_BUCKETS.map((_, execution) =>
      firstForExecutionSequence(execution),
    );

    expect(opportunities(wallClockFirst)).toEqual([8, 0]);
    expect(opportunities(sequenceFirst)).toEqual([4, 4]);

    expect(cleanup).not.toContain(
      'extract(epoch from pg_catalog.statement_timestamp())/600',
    );
    expect(phase10).toContain('priority_first_count bigint not null default 0');
    expect(cleanup).toContain('c.priority_first_count');
    expect(cleanup).toContain('c.priority_first_count+1');
    expect(cleanup).toContain('rescue_first_name');
    expect(cleanup).toContain('rescue_second_name');
  });

  it('keeps the phase-35 aggregate call-start envelope intact', () => {
    expect(cleanup).toContain("interval '250 milliseconds'");
    expect(cleanup).toContain("interval '500 milliseconds'");
    expect(cleanup).toContain('rescue_total_deadline');
    expect(
      (cleanup.match(/pg_catalog\.clock_timestamp\(\)<rescue_total_deadline/g) ?? []).length,
    ).toBeGreaterThanOrEqual(3);
  });
});
