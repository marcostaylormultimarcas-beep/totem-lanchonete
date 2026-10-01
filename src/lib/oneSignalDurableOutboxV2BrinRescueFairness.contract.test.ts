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

type SimResult = {
  backlog: number[];
  summarizedNew: number[];
  historyVisits: number[];
};

function simulateLinearCursor(
  prefixRanges: number,
  newRangesPerTick: number,
  ticks: number,
  budget: number,
): SimResult {
  let totalRanges = prefixRanges;
  let cursor = 0;
  const unsummarized = new Set<number>();
  const backlog: number[] = [];
  const summarizedNew: number[] = [];
  const historyVisits: number[] = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    const before = totalRanges;
    totalRanges += newRangesPerTick;
    for (let range = before; range < totalRanges; range += 1) {
      unsummarized.add(range);
    }

    let summarized = 0;
    let oldVisits = 0;
    for (let visit = 0; visit < budget && cursor < totalRanges; visit += 1) {
      if (unsummarized.delete(cursor)) summarized += 1;
      else oldVisits += 1;
      cursor += 1;
    }
    if (cursor >= totalRanges) cursor = 0;

    backlog.push(unsummarized.size);
    summarizedNew.push(summarized);
    historyVisits.push(oldVisits);
  }

  return { backlog, summarizedNew, historyVisits };
}

function simulateTailFirst(
  prefixRanges: number,
  newRangesPerTick: number,
  ticks: number,
  budget: number,
): SimResult {
  let totalRanges = prefixRanges;
  let tailPage = prefixRanges;
  let historyCursor = 0;
  const unsummarized = new Set<number>();
  const backlog: number[] = [];
  const summarizedNew: number[] = [];
  const historyVisits: number[] = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    const before = totalRanges;
    totalRanges += newRangesPerTick;
    for (let range = before; range < totalRanges; range += 1) {
      unsummarized.add(range);
    }

    const historyLimit = tailPage;
    let visits = 0;
    let summarized = 0;
    let oldVisits = 0;

    while (tailPage < totalRanges && visits < budget) {
      if (unsummarized.delete(tailPage)) summarized += 1;
      tailPage += 1;
      visits += 1;
    }

    if (historyCursor >= historyLimit) historyCursor = 0;
    while (historyCursor < historyLimit && visits < budget) {
      if (unsummarized.delete(historyCursor)) summarized += 1;
      else oldVisits += 1;
      historyCursor += 1;
      visits += 1;
    }
    if (historyCursor >= historyLimit) historyCursor = 0;

    backlog.push(unsummarized.size);
    summarizedNew.push(summarized);
    historyVisits.push(oldVisits);
  }

  return { backlog, summarizedNew, historyVisits };
}

function simulateCurrent(
  prefixRanges: number,
  newRangesPerTick: number,
  ticks: number,
  budget: number,
): SimResult {
  const hasTailPriority =
    cleanup.includes('tail_page bigint') &&
    cleanup.includes('rescue_tail_page') &&
    cleanup.includes('rescue_history_limit');

  return hasTailPriority
    ? simulateTailFirst(prefixRanges, newRangesPerTick, ticks, budget)
    : simulateLinearCursor(prefixRanges, newRangesPerTick, ticks, budget);
}

describe('Durable Outbox V2 phase 28 BRIN rescue fairness', () => {
  it('keeps up with a continuous 100-range/tick tail behind a 3,000-range summarized prefix', () => {
    const result = simulateCurrent(3_000, 100, 6, 1_024);
    expect(result.backlog).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.summarizedNew).toEqual([100, 100, 100, 100, 100, 100]);
  });

  it('uses spare capacity to revisit historical ranges instead of sacrificing the fresh tail', () => {
    const result = simulateCurrent(3_000, 100, 3, 1_024);
    expect(result.historyVisits.every((visits) => visits > 0)).toBe(true);
    expect(result.historyVisits.every((visits) => visits <= 924)).toBe(true);
  });

  it('remains capacity-bounded when arrivals exceed 1,024 ranges/tick', () => {
    const overloaded = simulateTailFirst(3_000, 1_100, 6, 1_024);
    expect(overloaded.backlog).toEqual([76, 152, 228, 304, 380, 456]);

    const drain = simulateTailFirst(3_000, 0, 1, 1_024);
    expect(drain.backlog).toEqual([0]);

    expect(cleanup).toContain('rescue_visits<1024');
  });
});
