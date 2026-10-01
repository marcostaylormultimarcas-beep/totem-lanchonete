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

type Row = {
  tick: number;
  tailVisits: number;
  historyVisits: number;
  backlog: number;
  visitLimit: number;
};

function simulateSaturatedBoundary(
  ticks: number,
  arrivalsPerTick: number,
  additiveFairnessVisit: boolean,
): Row[] {
  let backlog = 0;
  let historyDue = false;
  const rows: Row[] = [];

  for (let tick = 1; tick <= ticks; tick += 1) {
    backlog += arrivalsPerTick;
    let visits = 0;
    let historyVisits = 0;
    let visitLimit = 1_024;

    if (historyDue) {
      if (additiveFairnessVisit) visitLimit += 1;
      historyVisits = 1;
      visits += 1;
    }

    const tailVisits = Math.min(backlog, visitLimit - visits);
    backlog -= tailVisits;
    visits += tailVisits;

    historyDue = historyVisits === 0;
    rows.push({ tick, tailVisits, historyVisits, backlog, visitLimit });
  }

  return rows;
}

function denseLockSkipUpperBound(
  cooperativeDeadlineMs: number,
  lockTimeoutMs: number,
): { attempts: number; elapsedMs: number } {
  let elapsedMs = 0;
  let attempts = 0;
  while (elapsedMs < cooperativeDeadlineMs) {
    attempts += 1;
    elapsedMs += lockTimeoutMs;
  }
  return { attempts, elapsedMs };
}

describe('Durable Outbox V2 phase 30 BRIN rescue operational cost and boundary capacity', () => {
  it('preserves the nominal 1,024-range tail capacity while repaying history debt', () => {
    const additiveFairnessVisit =
      cleanup.includes('rescue_visit_limit') &&
      cleanup.includes('rescue_visit_limit:=1025');

    const rows = simulateSaturatedBoundary(8, 1_024, additiveFairnessVisit);

    expect(rows.map((row) => row.backlog)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(rows.filter((row) => row.historyVisits > 0).length).toBeGreaterThanOrEqual(4);
    expect(rows.every((row) => row.tailVisits === 1_024)).toBe(true);
    expect(Math.max(...rows.map((row) => row.visitLimit))).toBeLessThanOrEqual(1_025);
  });

  it('keeps dense lock waits bounded by the cooperative deadline plus one lock wait', () => {
    expect(cleanup).toContain("interval '250 milliseconds'");
    expect(cleanup).toContain("'100ms'");

    const bound = denseLockSkipUpperBound(250, 100);
    expect(bound).toEqual({ attempts: 3, elapsedMs: 300 });
  });

  it('retains per-range lock_not_available isolation without broad exception swallowing', () => {
    const isolatedSummaries = cleanup.match(
      /begin\s+rescue_count:=rescue_count\+\s*pg_catalog\.brin_summarize_range\([\s\S]*?exception when lock_not_available then/g,
    ) ?? [];

    expect(isolatedSummaries.length).toBeGreaterThanOrEqual(3);
    expect(cleanup).not.toContain('exception when others then\n          rescue_lock_skips');
  });
});
