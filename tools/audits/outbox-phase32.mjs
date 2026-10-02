import assert from 'node:assert/strict';

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const BASE_DEADLINE_MS = 250;
const REFUND_CAP_MS = 100;
const HISTORY_IO_MS = 300;
const REFUND_ONLY_TAIL_IO_MS = 300_000;
const EDGE_CALL_MS = 0.2442;

function simulateDebtIndex({refundEnabled, historyIoMs = HISTORY_IO_MS, tailIoMs = REFUND_ONLY_TAIL_IO_MS}) {
  let elapsedMs = 0;
  let deadlineAtMs = BASE_DEADLINE_MS;
  let refundOnlyTailCalls = 0;

  const historyStartedAtMs = elapsedMs;
  elapsedMs += historyIoMs;

  if (refundEnabled) {
    deadlineAtMs += Math.min(
      elapsedMs - historyStartedAtMs,
      REFUND_CAP_MS,
    );
  }

  if (elapsedMs < deadlineAtMs) {
    refundOnlyTailCalls += 1;
    elapsedMs += tailIoMs;
  }

  return {elapsedMs, deadlineAtMs, refundOnlyTailCalls};
}

function simulateTwoIndexes(refundEnabled) {
  const first = simulateDebtIndex({refundEnabled});
  const second = simulateDebtIndex({refundEnabled});
  const elapsedMs = first.elapsedMs + second.elapsedMs;
  return {
    first,
    second,
    elapsedMs,
    scheduledTicksReached: Math.floor(elapsedMs / CLEANUP_INTERVAL_MS),
  };
}

function simulateJustBindingCapacity({ticks = 8, arrivalsPerTick = 1024}) {
  let backlog = 0;
  let historyDue = false;
  const rows = [];

  for (let tick = 1; tick <= ticks; tick += 1) {
    backlog += arrivalsPerTick;
    let elapsedMs = 0;
    let visits = 0;
    let tailVisits = 0;
    let historyVisits = 0;
    let visitLimit = 1024;

    if (historyDue && elapsedMs < BASE_DEADLINE_MS) {
      visitLimit = 1025;
      elapsedMs += EDGE_CALL_MS;
      visits += 1;
      historyVisits += 1;
    }

    while (
      backlog > 0 &&
      visits < visitLimit &&
      elapsedMs < BASE_DEADLINE_MS
    ) {
      elapsedMs += EDGE_CALL_MS;
      visits += 1;
      tailVisits += 1;
      backlog -= 1;
    }

    historyDue = historyVisits === 0;
    rows.push({
      tick,
      tail_visits: tailVisits,
      history_visits: historyVisits,
      visits,
      backlog,
      history_due: historyDue,
      elapsed_ms: Number(elapsedMs.toFixed(4)),
    });
  }

  return rows;
}

const before = simulateTwoIndexes(true);
const after = simulateTwoIndexes(false);
const justBinding = simulateJustBindingCapacity({});

assert.equal(before.first.refundOnlyTailCalls, 1);
assert.equal(before.second.refundOnlyTailCalls, 1);
assert.equal(before.elapsedMs, 600_600);
assert.equal(before.scheduledTicksReached, 1);

assert.equal(after.first.refundOnlyTailCalls, 0);
assert.equal(after.second.refundOnlyTailCalls, 0);
assert.equal(after.elapsedMs, 600);
assert.equal(after.scheduledTicksReached, 0);

assert.deepEqual(
  justBinding.map((row) => row.backlog),
  [0, 1, 1, 2, 2, 3, 3, 4],
);
assert.ok(justBinding.every((row) => row.visits <= 1025));

console.log(JSON.stringify({
  scenario: 'phase31_two_index_refund_slow_io_before',
  ...before,
  cleanup_interval_ms: CLEANUP_INTERVAL_MS,
}));
console.log(JSON.stringify({
  scenario: 'phase32_two_index_no_refund_after',
  ...after,
  cleanup_interval_ms: CLEANUP_INTERVAL_MS,
}));
console.log(JSON.stringify({
  scenario: 'phase32_just_binding_capacity_tradeoff',
  rows: justBinding,
}));
console.log(JSON.stringify({
  checks: 'PASS',
  base_deadline_ms: BASE_DEADLINE_MS,
  history_refund_cap_ms_removed: REFUND_CAP_MS,
  debt_tick_visit_limit_preserved: 1025,
}));
