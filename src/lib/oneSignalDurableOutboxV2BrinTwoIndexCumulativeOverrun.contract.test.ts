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

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const PER_INDEX_DEADLINE_MS = 250;
const TOTAL_RESCUE_DEADLINE_MS = 2 * PER_INDEX_DEADLINE_MS;
const EPSILON_MS = 0.001;
const LATEST_LOCAL_START_MS = PER_INDEX_DEADLINE_MS - EPSILON_MS;
const EQUAL_SUB_TEN_MINUTE_STALL_MS =
  (CLEANUP_INTERVAL_MS - 2 * LATEST_LOCAL_START_MS) / 2;

function hasAggregateCallStartDeadline(): boolean {
  return (
    cleanup.includes('rescue_total_deadline') &&
    cleanup.includes("interval '500 milliseconds'") &&
    (cleanup.match(/pg_catalog\.clock_timestamp\(\)<rescue_total_deadline/g) ?? []).length >= 3
  );
}

function simulateTwoFinalCalls(aggregateDeadlineEnabled: boolean) {
  let elapsedMs = 0;
  let calls = 0;
  const globalDeadlineAtMs = aggregateDeadlineEnabled
    ? TOTAL_RESCUE_DEADLINE_MS
    : Number.POSITIVE_INFINITY;
  const finishes: number[] = [];

  for (let index = 0; index < 2; index += 1) {
    const localDeadlineAtMs = elapsedMs + PER_INDEX_DEADLINE_MS;
    const latestLegitimateStartMs = localDeadlineAtMs - EPSILON_MS;

    // Cheap visits consume the cooperative window until the final authorized
    // call. With independent deadlines, index 2 receives a fresh 250ms window
    // even after index 1 has spent minutes in post-lock I/O.
    if (latestLegitimateStartMs >= globalDeadlineAtMs) {
      continue;
    }

    elapsedMs = latestLegitimateStartMs;
    calls += 1;
    elapsedMs += EQUAL_SUB_TEN_MINUTE_STALL_MS;
    finishes.push(elapsedMs);
  }

  return {
    elapsedMs,
    calls,
    finishes,
    reachesNextScheduledTick: elapsedMs >= CLEANUP_INTERVAL_MS,
  };
}

describe('Durable Outbox V2 phase 35 cumulative two-index BRIN overrun', () => {
  it('does not authorize two sub-10-minute final-call stalls that cumulatively reach the next cleanup tick', () => {
    expect(phase9).toContain("'*/10 * * * *'");
    expect(cleanup).toContain("interval '250 milliseconds'");
    expect(EQUAL_SUB_TEN_MINUTE_STALL_MS).toBeGreaterThan(299_749);
    expect(EQUAL_SUB_TEN_MINUTE_STALL_MS).toBeLessThan(299_751);
    expect(EQUAL_SUB_TEN_MINUTE_STALL_MS).toBeLessThan(CLEANUP_INTERVAL_MS);

    const result = simulateTwoFinalCalls(hasAggregateCallStartDeadline());

    expect(result.calls).toBe(1);
    expect(result.reachesNextScheduledTick).toBe(false);
    expect(result.elapsedMs).toBeLessThan(CLEANUP_INTERVAL_MS);
  });

  it('keeps retention/DELETE before BRIN rescue while bounding only rescue call authorization', () => {
    const deleteAt = cleanup.indexOf('delete from private.onesignal_outbox o');
    const rescueAt = cleanup.indexOf('foreach rescue_name in array array[');

    expect(deleteAt).toBeGreaterThan(-1);
    expect(rescueAt).toBeGreaterThan(deleteAt);
    expect(cleanup).toContain("pg_catalog.brin_summarize_range(");
  });
});
