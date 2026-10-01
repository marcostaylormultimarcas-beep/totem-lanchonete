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

type FairnessResult = {
  tailCursor: number;
  historyCursor: number;
  historyVisits: number[];
};

function simulateSaturatedTail(
  ticks: number,
  budget: number,
  hasHistoryDebt: boolean,
): FairnessResult {
  let tailCursor = 3_000;
  let historyCursor = 0;
  let historyDue = false;
  const historyVisits: number[] = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    let visits = 0;
    let historyThisTick = 0;

    if (hasHistoryDebt && historyDue && visits < budget) {
      historyCursor += 1;
      historyThisTick += 1;
      visits += 1;
    }

    // Continuous arrivals keep the fresh tail saturated above the remaining
    // budget, so a strict tail-first scheduler consumes every visit left.
    tailCursor += budget - visits;
    visits = budget;

    // No spare budget remains for the ordinary historical pass.
    historyDue = hasHistoryDebt && historyThisTick === 0;
    historyVisits.push(historyThisTick);
  }

  return { tailCursor, historyCursor, historyVisits };
}

function simulateDeadlineDominance(
  ticks: number,
  hasHistoryDebt: boolean,
): FairnessResult {
  let tailCursor = 3_000;
  let historyCursor = 0;
  let historyDue = false;
  const historyVisits: number[] = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    let historyThisTick = 0;

    if (hasHistoryDebt && historyDue) {
      // The forced historical probe gets the first scheduling opportunity on
      // the debt tick. Even if that one call consumes the cooperative deadline,
      // persistent historical progress is made.
      historyCursor += 1;
      historyThisTick += 1;
      historyDue = false;
    } else {
      // Model a tail summarize call that consumes the cooperative time budget.
      tailCursor += 1;
      historyDue = hasHistoryDebt;
    }

    historyVisits.push(historyThisTick);
  }

  return { tailCursor, historyCursor, historyVisits };
}

describe('Durable Outbox V2 phase 29 BRIN rescue fairness under deadline and lock skips', () => {
  it('does not starve historical review under a continuously saturated fresh tail', () => {
    const hasHistoryDebt =
      sql.includes('history_due boolean') &&
      cleanup.includes('rescue_history_due');

    const result = simulateSaturatedTail(8, 1_024, hasHistoryDebt);

    expect(result.tailCursor).toBeGreaterThan(3_000);
    expect(result.historyCursor).toBeGreaterThan(0);
    expect(result.historyVisits.some((visits) => visits > 0)).toBe(true);
  });

  it('carries fairness debt across cooperative-deadline exhaustion so both cursors persist progress', () => {
    const hasHistoryDebt =
      sql.includes('history_due boolean') &&
      cleanup.includes('rescue_history_due');

    const result = simulateDeadlineDominance(6, hasHistoryDebt);

    expect(result.tailCursor).toBeGreaterThan(3_000);
    expect(result.historyCursor).toBeGreaterThan(0);
    expect(result.historyVisits.filter((visits) => visits > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('isolates lock_not_available per BRIN range instead of rolling back the whole index rescue', () => {
    const isolatedSummaries = cleanup.match(
      /begin\s+rescue_count:=rescue_count\+\s*pg_catalog\.brin_summarize_range\([\s\S]*?exception when lock_not_available then/g,
    ) ?? [];

    expect(isolatedSummaries.length).toBeGreaterThanOrEqual(2);
    expect(cleanup).toContain('rescue_lock_skips:=rescue_lock_skips+1');
  });
});
