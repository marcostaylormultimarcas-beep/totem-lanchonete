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

const PER_INDEX_DEADLINE_MS = 250;
const TOTAL_RESCUE_DEADLINE_MS = 500;
const EPSILON_MS = 0.001;
const FINAL_CALL_POST_START_MS = 250.002;
const TICKS = 8;

function hasCrossIndexOrderRotation(): boolean {
  const wallClockRotation =
    cleanup.includes('pg_catalog.statement_timestamp()') &&
    cleanup.includes('extract(epoch from pg_catalog.statement_timestamp())') &&
    cleanup.includes('/600');

  const sequenceStableRotation =
    cleanup.includes('priority_first_count') &&
    cleanup.includes('c.priority_first_count+1') &&
    cleanup.includes('rescue_first_name') &&
    cleanup.includes('rescue_second_name');

  return (
    (wallClockRotation || sequenceStableRotation) &&
    (cleanup.match(/private\.onesignal_outbox_health_created_idx/g) ?? []).length >= 2 &&
    (cleanup.match(/private\.onesignal_outbox_attempts_health_created_idx/g) ?? []).length >= 2
  );
}

function orderForTick(tick: number, rotating: boolean): [number, number] {
  if (!rotating || tick % 2 === 0) return [0, 1];
  return [1, 0];
}

function simulateSustainedEnvelopePressure(rotating: boolean) {
  const opportunities = [0, 0];
  const secondSkipped = [0, 0];

  for (let tick = 0; tick < TICKS; tick += 1) {
    const order = orderForTick(tick, rotating);
    const firstStartMs = PER_INDEX_DEADLINE_MS - EPSILON_MS;
    const firstFinishMs = firstStartMs + FINAL_CALL_POST_START_MS;

    opportunities[order[0]] += 1;

    if (firstFinishMs >= TOTAL_RESCUE_DEADLINE_MS) {
      secondSkipped[order[1]] += 1;
      continue;
    }

    opportunities[order[1]] += 1;
  }

  return { opportunities, secondSkipped };
}

describe('Durable Outbox V2 phase 36 aggregate BRIN envelope fairness', () => {
  it('does not let the same first BRIN index monopolize the aggregate envelope across sustained cleanup ticks', () => {
    expect(phase9).toContain("'*/10 * * * *'");
    expect(cleanup).toContain("interval '250 milliseconds'");
    expect(cleanup).toContain("interval '500 milliseconds'");

    const finalCallFinishMs =
      PER_INDEX_DEADLINE_MS - EPSILON_MS + FINAL_CALL_POST_START_MS;
    expect(finalCallFinishMs).toBeGreaterThan(TOTAL_RESCUE_DEADLINE_MS);
    expect(finalCallFinishMs).toBeLessThan(501);

    const result = simulateSustainedEnvelopePressure(hasCrossIndexOrderRotation());

    expect(result.opportunities[0]).toBeGreaterThan(0);
    expect(result.opportunities[1]).toBeGreaterThan(0);
    expect(Math.abs(result.opportunities[0] - result.opportunities[1])).toBeLessThanOrEqual(1);
  });

  it('keeps the phase-35 aggregate call-start guard intact', () => {
    expect(cleanup).toContain('rescue_total_deadline');
    expect(
      (cleanup.match(/pg_catalog\.clock_timestamp\(\)<rescue_total_deadline/g) ?? []).length,
    ).toBeGreaterThanOrEqual(3);
  });
});
