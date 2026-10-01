import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20261001150000_visionfood_v2_onesignal_durable_outbox_observability_backpressure_phase10.sql',
  'utf8',
);

const cleanup = sql.slice(
  sql.indexOf('create or replace function private.visionfood_onesignal_outbox_cleanup('),
  sql.indexOf('create or replace function private.visionfood_onesignal_outbox_health('),
);

const DEADLINE_MS = 250;
const CALL_MS = 0.2442;
const PAGES_PER_RANGE = 8;
const PAGE_BYTES = 8192;
const TICKS_PER_DAY = 144;

type Row = {
  arrivals: number;
  tailVisits: number;
  historyVisits: number;
  backlog: number;
  historyDue: boolean;
};

function simulate(arrivals: number[], callMs = CALL_MS): Row[] {
  let backlog = 0;
  let historyDue = false;
  const rows: Row[] = [];

  for (const arrival of arrivals) {
    backlog += arrival;
    let elapsedMs = 0;
    let visits = 0;
    let tailVisits = 0;
    let historyVisits = 0;
    let visitLimit = 1_024;

    if (historyDue && elapsedMs < DEADLINE_MS) {
      visitLimit = 1_025;
      elapsedMs += callMs;
      visits += 1;
      historyVisits += 1;
    }

    while (
      backlog > 0 &&
      visits < visitLimit &&
      elapsedMs < DEADLINE_MS
    ) {
      elapsedMs += callMs;
      visits += 1;
      tailVisits += 1;
      backlog -= 1;
    }

    historyDue = historyVisits === 0;
    rows.push({
      arrivals: arrival,
      tailVisits,
      historyVisits,
      backlog,
      historyDue,
    });
  }

  return rows;
}

describe('Durable Outbox V2 phase 33 just-binding backlog audit', () => {
  it('keeps the phase-32 runtime unchanged', () => {
    expect(cleanup).toContain("interval '250 milliseconds'");
    expect(cleanup).toContain('rescue_visit_limit:=1025');
    expect(cleanup).not.toContain('rescue_history_started_at');
    expect(cleanup).not.toContain('rescue_deadline:=rescue_deadline+least(');
  });

  it('confines the phase-32 incremental capacity loss to a sub-0.1% call-time band', () => {
    const fullDebtTailThresholdMs = DEADLINE_MS / 1_024;
    const fullNormalTailThresholdMs = DEADLINE_MS / 1_023;
    const relativeBand =
      (fullNormalTailThresholdMs - fullDebtTailThresholdMs) /
      fullDebtTailThresholdMs;

    expect(fullDebtTailThresholdMs).toBeCloseTo(0.244140625, 9);
    expect(fullNormalTailThresholdMs).toBeCloseTo(0.2443792766, 9);
    expect(relativeBand).toBeLessThan(0.001);
  });

  it('bounds exact 1,024/tick just-binding growth to 72 ranges/day and one nominal rescue tick only after >14 days', () => {
    const day = simulate(Array.from({ length: TICKS_PER_DAY }, () => 1_024));
    const fortnight = simulate(Array.from({ length: 2_048 }, () => 1_024));

    expect(day.at(-1)?.backlog).toBe(72);
    expect(fortnight.at(-1)?.backlog).toBe(1_024);

    const dayHeapBytes = 72 * PAGES_PER_RANGE * PAGE_BYTES;
    expect(dayHeapBytes).toBe(4.5 * 1024 * 1024);
  });

  it('drains the incremental loss with only 0.5 range/tick of average headroom', () => {
    const rows = simulate(
      Array.from({ length: 72 }, () => [1_024, 1_023]).flat(),
    );

    expect(rows.at(-1)?.backlog).toBe(0);
    expect(Math.max(...rows.map((row) => row.backlog))).toBe(0);
  });
});
