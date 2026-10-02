import assert from 'node:assert/strict';

const NORMAL_VISIT_LIMIT = 1024;
const DEBT_VISIT_LIMIT = 1025;
const DEADLINE_MS = 250;
const REFUND_CAP_MS = 100;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const EDGE_CALL_MS = 0.2442;

function simulate({arrivals, refundHistoryTime, callMs = EDGE_CALL_MS}) {
  let backlog = 0;
  let historyDue = false;
  const rows = [];

  for (let index = 0; index < arrivals.length; index += 1) {
    backlog += arrivals[index];
    const startHistoryDue = historyDue;
    let elapsedMs = 0;
    let deadlineAtMs = DEADLINE_MS;
    let visitLimit = NORMAL_VISIT_LIMIT;
    let totalVisits = 0;
    let tailVisits = 0;
    let historyVisits = 0;

    if (historyDue && elapsedMs < deadlineAtMs) {
      visitLimit = DEBT_VISIT_LIMIT;
      const startedAtMs = elapsedMs;
      elapsedMs += callMs;
      totalVisits += 1;
      historyVisits += 1;
      if (refundHistoryTime) {
        deadlineAtMs += Math.min(elapsedMs - startedAtMs, REFUND_CAP_MS);
      }
    }

    while (backlog > 0 && totalVisits < visitLimit && elapsedMs < deadlineAtMs) {
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
      start_history_due: startHistoryDue,
      tail_visits: tailVisits,
      history_visits: historyVisits,
      total_visits: totalVisits,
      visit_limit: visitLimit,
      elapsed_ms: Number(elapsedMs.toFixed(4)),
      deadline_at_ms: Number(deadlineAtMs.toFixed(4)),
      backlog,
      history_due: historyDue,
    });
  }

  return rows;
}

function expectedTailBacklog(arrivals) {
  let backlog = 0;
  return arrivals.map((arrival) => {
    backlog = Math.max(0, backlog + arrival - NORMAL_VISIT_LIMIT);
    return backlog;
  });
}

function denseLockWaitBound({refundHistoryTime}) {
  const callMs = 100;
  let elapsedMs = 0;
  let deadlineAtMs = DEADLINE_MS;
  let attempts = 0;

  const historyStartedAtMs = elapsedMs;
  elapsedMs += callMs;
  attempts += 1;
  if (refundHistoryTime) {
    deadlineAtMs += Math.min(elapsedMs - historyStartedAtMs, REFUND_CAP_MS);
  }

  while (attempts < DEBT_VISIT_LIMIT && elapsedMs < deadlineAtMs) {
    elapsedMs += callMs;
    attempts += 1;
  }

  return {attempts, elapsed_ms: elapsedMs, deadline_at_ms: deadlineAtMs};
}

const before1024 = simulate({arrivals: Array(8).fill(1024), refundHistoryTime: false});
const after1024 = simulate({arrivals: Array(8).fill(1024), refundHistoryTime: true});
const after1023 = simulate({arrivals: Array(8).fill(1023), refundHistoryTime: true});
const after1025 = simulate({arrivals: Array(8).fill(1025), refundHistoryTime: true});
const variableArrivals = [1023, 1024, 1025, 1024, 1023, 1025, 1024, 1023];
const beforeVariable = simulate({arrivals: variableArrivals, refundHistoryTime: false});
const afterVariable = simulate({arrivals: variableArrivals, refundHistoryTime: true});
const fastBefore = simulate({arrivals: Array(4).fill(1024), refundHistoryTime: false, callMs: 0.2});
const fastAfter = simulate({arrivals: Array(4).fill(1024), refundHistoryTime: true, callMs: 0.2});
const denseBefore = denseLockWaitBound({refundHistoryTime: false});
const denseAfter = denseLockWaitBound({refundHistoryTime: true});
const twoIndexDenseDeltaMs = 2 * (denseAfter.elapsed_ms - denseBefore.elapsed_ms);

assert.deepEqual(before1024.map((row) => row.backlog), [0, 1, 1, 2, 2, 3, 3, 4]);
assert.deepEqual(after1024.map((row) => row.backlog), [0, 0, 0, 0, 0, 0, 0, 0]);
assert.deepEqual(after1024.map((row) => row.start_history_due), [false, true, false, true, false, true, false, true]);
assert.ok(after1024.filter((row) => row.start_history_due).every((row) => row.tail_visits === 1024));
assert.deepEqual(after1023.map((row) => row.backlog), Array(8).fill(0));
assert.deepEqual(after1025.map((row) => row.backlog), [1, 2, 3, 4, 5, 6, 7, 8]);
assert.deepEqual(afterVariable.map((row) => row.backlog), expectedTailBacklog(variableArrivals));
assert.deepEqual(fastAfter.map((row) => row.total_visits), fastBefore.map((row) => row.total_visits));
assert.ok(after1024.every((row) => row.total_visits <= DEBT_VISIT_LIMIT));
assert.deepEqual(denseBefore, {attempts: 3, elapsed_ms: 300, deadline_at_ms: 250});
assert.deepEqual(denseAfter, {attempts: 4, elapsed_ms: 400, deadline_at_ms: 350});
assert.equal(twoIndexDenseDeltaMs, 200);

console.log(JSON.stringify({scenario: 'phase30_short_deadline_1024_before_refund', rows: before1024}));
console.log(JSON.stringify({scenario: 'phase31_short_deadline_1024_after_refund', rows: after1024}));
console.log(JSON.stringify({scenario: 'phase31_short_deadline_1023_after_refund', rows: after1023}));
console.log(JSON.stringify({scenario: 'phase31_short_deadline_1025_after_refund', rows: after1025}));
console.log(JSON.stringify({scenario: 'phase30_variable_1023_1025_before_refund', rows: beforeVariable}));
console.log(JSON.stringify({scenario: 'phase31_variable_1023_1025_after_refund', rows: afterVariable}));
console.log(JSON.stringify({scenario: 'fast_path_cost_before', rows: fastBefore}));
console.log(JSON.stringify({scenario: 'fast_path_cost_after', rows: fastAfter}));
console.log(JSON.stringify({
  scenario: 'dense_100ms_lock_wait_bound',
  before: denseBefore,
  after: denseAfter,
  two_index_delta_ms: twoIndexDenseDeltaMs,
  cleanup_interval_ms: CLEANUP_INTERVAL_MS,
  interval_fraction: twoIndexDenseDeltaMs / CLEANUP_INTERVAL_MS,
}));
console.log(JSON.stringify({
  checks: 'PASS',
  normal_visit_limit: NORMAL_VISIT_LIMIT,
  debt_tick_visit_limit: DEBT_VISIT_LIMIT,
  deadline_ms: DEADLINE_MS,
  history_refund_cap_ms: REFUND_CAP_MS,
}));
