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
  startHistoryDue: boolean;
  tailVisits: number;
  historyVisits: number;
  totalVisits: number;
  backlog: number;
  historyDue: boolean;
};

function simulateShortDeadline(
  arrivals: number[],
  callMs = 0.2442,
  deadlineMs = 250,
): Row[] {
  let backlog = 0;
  let historyDue = false;
  const rows: Row[] = [];

  for (let index = 0; index < arrivals.length; index += 1) {
    backlog += arrivals[index];
    const startHistoryDue = historyDue;
    let elapsedMs = 0;
    let visitLimit = 1_024;
    let totalVisits = 0;
    let tailVisits = 0;
    let historyVisits = 0;

    if (historyDue && elapsedMs < deadlineMs) {
      visitLimit = 1_025;
      elapsedMs += callMs;
      totalVisits += 1;
      historyVisits += 1;
    }

    while (
      backlog > 0 &&
      totalVisits < visitLimit &&
      elapsedMs < deadlineMs
    ) {
      elapsedMs += callMs;
      backlog -= 1;
      totalVisits += 1;
      tailVisits += 1;
    }

    while (totalVisits < visitLimit && elapsedMs < deadlineMs) {
      elapsedMs += callMs;
      totalVisits += 1;
      historyVisits += 1;
    }

    historyDue = historyVisits === 0;
    rows.push({
      tick: index + 1,
      startHistoryDue,
      tailVisits,
      historyVisits,
      totalVisits,
      backlog,
      historyDue,
    });
  }

  return rows;
}

describe('Durable Outbox V2 phase 31/32 BRIN rescue deadline safety', () => {
  it('keeps the phase-30 additive visit cap without extending the 250ms call-start deadline', () => {
    expect(cleanup).toContain("interval '250 milliseconds'");
    expect(cleanup).toContain("'100ms'");
    expect(cleanup).toContain('rescue_visit_limit:=1025');
    expect(cleanup).not.toContain('rescue_history_started_at');
    expect(cleanup).not.toContain('rescue_deadline:=rescue_deadline+least(');
    expect(cleanup).toContain("interval '100 milliseconds'");
  });

  it('documents the deliberate just-binding capacity tradeoff after removing the unsafe time refund', () => {
    const rows = simulateShortDeadline(Array.from({ length: 8 }, () => 1_024));

    expect(rows.map((row) => row.startHistoryDue)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(rows.map((row) => row.backlog)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect(rows.filter((row) => row.startHistoryDue).every((row) => row.historyVisits >= 1)).toBe(true);
    expect(rows.every((row) => row.totalVisits <= 1_025)).toBe(true);
  });
});
