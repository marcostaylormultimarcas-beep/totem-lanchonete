import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const phase10 = readFileSync(
  'supabase/migrations/20261001150000_visionfood_v2_onesignal_durable_outbox_observability_backpressure_phase10.sql',
  'utf8',
);
const phase21 = readFileSync(
  'supabase/migrations/20261001175000_visionfood_v2_onesignal_durable_outbox_health_plan_phase21.sql',
  'utf8',
);
const phase9 = readFileSync(
  'supabase/migrations/20260930155000_visionfood_v2_onesignal_durable_outbox_retention_phase9.sql',
  'utf8',
);
const phase27Readme = readFileSync('docs/audits/outbox-phase27/README.md', 'utf8');

const cleanup = phase10.slice(
  phase10.indexOf('create or replace function private.visionfood_onesignal_outbox_cleanup('),
  phase10.indexOf('create or replace function private.visionfood_onesignal_outbox_health('),
);

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const COOPERATIVE_DEADLINE_MS = 250;
const EPSILON_MS = 0.001;
const LATEST_LEGITIMATE_START_MS = COOPERATIVE_DEADLINE_MS - EPSILON_MS;
const REQUIRED_SINGLE_CALL_STALL_MS = CLEANUP_INTERVAL_MS - LATEST_LEGITIMATE_START_MS;

function singleAuthorizedCall(ioMs: number) {
  const finishMs = LATEST_LEGITIMATE_START_MS + ioMs;
  return {
    finishMs,
    reachesNextScheduledTick: finishMs >= CLEANUP_INTERVAL_MS,
  };
}

describe('Durable Outbox V2 phase 34 single BRIN call residual overrun audit', () => {
  it('keeps the residual risk structurally bounded to an already-authorized single-range call', () => {
    expect(phase9).toContain("'*/10 * * * *'");
    expect(cleanup).toContain("interval '250 milliseconds'");
    expect(cleanup).toContain("'100ms'");
    expect(cleanup).toContain('pg_catalog.brin_summarize_range(');
    expect(cleanup).not.toContain('rescue_history_started_at');
    expect(cleanup).not.toContain('rescue_deadline:=rescue_deadline+least(');
    expect(cleanup).not.toMatch(/statement_timeout/i);
    expect((phase21.match(/pages_per_range=8/g) ?? []).length).toBeGreaterThanOrEqual(2);

    const deleteAt = cleanup.indexOf('delete from private.onesignal_outbox o');
    const rescueAt = cleanup.indexOf('foreach rescue_name in array array[');
    expect(deleteAt).toBeGreaterThan(-1);
    expect(rescueAt).toBeGreaterThan(deleteAt);

    // This completion-overrun property predates phases 31-33. Phase 27 already
    // documented the cooperative deadline as non-hard for a single range call.
    expect(phase27Readme).toContain('one range may overrun it');
  });

  it('shows that one call starting just before 250ms needs about 599.75s of post-start work to reach the next 10-minute tick', () => {
    expect(singleAuthorizedCall(300).reachesNextScheduledTick).toBe(false);
    expect(singleAuthorizedCall(5 * 60 * 1000).reachesNextScheduledTick).toBe(false);
    expect(singleAuthorizedCall(REQUIRED_SINGLE_CALL_STALL_MS).reachesNextScheduledTick).toBe(true);

    expect(REQUIRED_SINGLE_CALL_STALL_MS).toBeGreaterThan(599_749);
    expect(REQUIRED_SINGLE_CALL_STALL_MS).toBeLessThan(599_751);
  });
});
