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
const BASE_DEADLINE_MS = 250;
const REFUND_CAP_MS = 100;
const HISTORY_IO_MS = 300;
const REFUND_ONLY_TAIL_IO_MS = 300_000;

function hasPhase31DeadlineRefund(): boolean {
  return (
    cleanup.includes('rescue_history_started_at') &&
    cleanup.includes('rescue_deadline:=rescue_deadline+least(') &&
    cleanup.includes("interval '100 milliseconds'")
  );
}

function simulateDebtIndex(refundEnabled: boolean) {
  let elapsedMs = 0;
  let deadlineAtMs = BASE_DEADLINE_MS;
  let refundOnlyTailCalls = 0;

  // The forced historical range acquires its lock successfully, then spends
  // 300ms in I/O. lock_timeout cannot stop post-acquisition I/O.
  const historyStartedAtMs = elapsedMs;
  elapsedMs += HISTORY_IO_MS;

  if (refundEnabled) {
    deadlineAtMs += Math.min(
      elapsedMs - historyStartedAtMs,
      REFUND_CAP_MS,
    );
  }

  // Phase 30 would stop here because 300ms > 250ms. Phase 31 extends the
  // call-start window to 350ms, authorizing one tail summarize call that did
  // not exist before the refund. That call also acquires its lock, then stalls
  // on slow I/O for five minutes.
  if (elapsedMs < deadlineAtMs) {
    refundOnlyTailCalls += 1;
    elapsedMs += REFUND_ONLY_TAIL_IO_MS;
  }

  return {
    elapsedMs,
    deadlineAtMs,
    refundOnlyTailCalls,
  };
}

function simulateTwoDebtIndexes(refundEnabled: boolean) {
  const first = simulateDebtIndex(refundEnabled);
  const second = simulateDebtIndex(refundEnabled);
  const elapsedMs = first.elapsedMs + second.elapsedMs;

  return {
    first,
    second,
    elapsedMs,
    scheduledTicksReached: Math.floor(elapsedMs / CLEANUP_INTERVAL_MS),
  };
}

describe('Durable Outbox V2 phase 32 BRIN rescue refund I/O overlap', () => {
  it('does not let the phase-31 refund open a new non-cooperative I/O call window that reaches the next 10-minute cleanup tick', () => {
    expect(phase9).toContain("'*/10 * * * *'");
    expect(cleanup).toContain("pg_try_advisory_xact_lock(cleanup_lock)");
    expect(cleanup).toContain("interval '250 milliseconds'");
    expect(cleanup).toContain("'100ms'");

    const result = simulateTwoDebtIndexes(hasPhase31DeadlineRefund());

    expect(result.first.refundOnlyTailCalls).toBe(0);
    expect(result.second.refundOnlyTailCalls).toBe(0);
    expect(result.elapsedMs).toBeLessThan(CLEANUP_INTERVAL_MS);
    expect(result.scheduledTicksReached).toBe(0);
  });

  it('keeps retention/DELETE ahead of rescue so a long rescue cannot be mistaken for concurrent retention work', () => {
    const deleteAt = cleanup.indexOf('delete from private.onesignal_outbox o');
    const rescueAt = cleanup.indexOf('foreach rescue_name in array array[');

    expect(deleteAt).toBeGreaterThan(-1);
    expect(rescueAt).toBeGreaterThan(deleteAt);
  });
});
