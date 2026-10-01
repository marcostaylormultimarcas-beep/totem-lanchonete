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
  arrivals: number;
  startHistoryDue: boolean;
  tailVisits: number;
  historyVisits: number;
  totalVisits: number;
  backlog: number;
  elapsedMs: number;
  historyDue: boolean;
};

function hasBoundedHistoryDeadlineRefund(): boolean {
  return (
    cleanup.includes('rescue_history_started_at') &&
    cleanup.includes('rescue_deadline:=rescue_deadline+least(') &&
    cleanup.includes("interval '100 milliseconds'")
  );
}

function simulateShortDeadline(
  arrivals: number[],
  refundHistoryTime: boolean,
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
    let deadlineAtMs = deadlineMs;
    let visitLimit = 1_024;
    let totalVisits = 0;
    let tailVisits = 0;
    let historyVisits = 0;

    if (historyDue && elapsedMs < deadlineAtMs) {
      visitLimit = 1_025;
      const startedAtMs = elapsedMs;
      elapsedMs += callMs;
      totalVisits += 1;
      historyVisits += 1;

      if (refundHistoryTime) {
        deadlineAtMs += Math.min(elapsedMs - startedAtMs, 100);
      }
    }

    while (
      backlog > 0 &&
      totalVisits < visitLimit &&
      elapsedMs < deadlineAtMs
    ) {
      elapsedMs += callMs;
      backlog -= 1;
      totalVisits += 1;
      tailVisits += 1;
    }

    while (totalVisits < visitLimit && elapsedMs < deadlineAtMs) {
      elapsedMs += callMs;
      totalVisits += 1;
      historyVisits += 1;
    }

    historyDue = historyVisits === 0;
    rows.push({
      tick: index + 1,
      arrivals: arrivals[index],
      startHistoryDue,
      tailVisits,
      historyVisits,
      totalVisits,
      backlog,
      elapsedMs,
      historyDue,
    });
  }

  return rows;
}

function expectedTailBacklog(arrivals: number[], tailCapacity = 1_024): number[] {
  let backlog = 0;
  return arrivals.map((arrival) => {
    backlog = Math.max(0, backlog + arrival - tailCapacity);
    return backlog;
  });
}

describe('Durable Outbox V2 phase 31 BRIN rescue deadline capacity', () => {
  it('keeps the full 1,024 tail visits on alternating history_due ticks when the 250ms deadline is just binding', () => {
    const rows = simulateShortDeadline(
      Array.from({ length: 8 }, () => 1_024),
      hasBoundedHistoryDeadlineRefund(),
    );

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
    expect(rows.map((row) => row.backlog)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(rows.filter((row) => row.startHistoryDue).every((row) => row.tailVisits === 1_024)).toBe(true);
    expect(Math.max(...rows.map((row) => row.totalVisits))).toBe(1_025);
  });

  it('makes 1,023-1,025 range/tick backlog movement depend on arrivals, not history_due oscillation', () => {
    const arrivals = [1_023, 1_024, 1_025, 1_024, 1_023, 1_025, 1_024, 1_023];
    const rows = simulateShortDeadline(
      arrivals,
      hasBoundedHistoryDeadlineRefund(),
    );

    expect(rows.map((row) => row.backlog)).toEqual(expectedTailBacklog(arrivals));
  });

  it('keeps the deadline refund bounded to one 100ms lock-wait envelope per debt tick', () => {
    expect(cleanup).toContain("interval '250 milliseconds'");
    expect(cleanup).toContain("'100ms'");
    expect(cleanup).toContain("interval '100 milliseconds'");
    expect(cleanup).not.toContain("rescue_deadline:=pg_catalog.clock_timestamp()+interval '350 milliseconds'");
  });
});
