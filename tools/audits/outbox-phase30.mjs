import assert from 'node:assert/strict';

const NORMAL_VISIT_LIMIT = 1024;

function simulate({ticks, arrivalsPerTick, additiveFairnessVisit}) {
  let backlog = 0;
  let historyDue = false;
  const rows = [];
  for (let tick = 1; tick <= ticks; tick += 1) {
    backlog += arrivalsPerTick;
    let visits = 0;
    let historyVisits = 0;
    let visitLimit = NORMAL_VISIT_LIMIT;

    if (historyDue) {
      if (additiveFairnessVisit) visitLimit += 1;
      historyVisits = 1;
      visits += 1;
    }

    const tailVisits = Math.min(backlog, visitLimit - visits);
    backlog -= tailVisits;
    visits += tailVisits;
    historyDue = historyVisits === 0;

    rows.push({
      tick,
      arrivals: arrivalsPerTick,
      tail_visits: tailVisits,
      history_visits: historyVisits,
      visit_limit: visitLimit,
      backlog,
    });
  }
  return rows;
}

function denseLockWaitBound(deadlineMs = 250, lockTimeoutMs = 100) {
  let elapsedMs = 0;
  let attempts = 0;
  while (elapsedMs < deadlineMs) {
    attempts += 1;
    elapsedMs += lockTimeoutMs;
  }
  return { attempts, elapsed_ms: elapsedMs };
}

const boundaryBefore = simulate({ticks: 8, arrivalsPerTick: 1024, additiveFairnessVisit: false});
const boundaryAfter = simulate({ticks: 8, arrivalsPerTick: 1024, additiveFairnessVisit: true});
const nearLimitBefore = simulate({ticks: 8, arrivalsPerTick: 1023, additiveFairnessVisit: false});
const nearLimitAfter = simulate({ticks: 8, arrivalsPerTick: 1023, additiveFairnessVisit: true});
const overloadBefore = simulate({ticks: 6, arrivalsPerTick: 1100, additiveFairnessVisit: false});
const overloadAfter = simulate({ticks: 6, arrivalsPerTick: 1100, additiveFairnessVisit: true});
const denseLockBound = denseLockWaitBound();

assert.deepEqual(boundaryBefore.map((x) => x.backlog), [0, 1, 1, 2, 2, 3, 3, 4]);
assert.deepEqual(boundaryAfter.map((x) => x.backlog), [0, 0, 0, 0, 0, 0, 0, 0]);
assert.ok(nearLimitBefore.every((x) => x.backlog === 0));
assert.ok(nearLimitAfter.every((x) => x.backlog === 0));
assert.deepEqual(overloadBefore.map((x) => x.backlog), [76, 153, 229, 306, 382, 459]);
assert.deepEqual(overloadAfter.map((x) => x.backlog), [76, 152, 228, 304, 380, 456]);
assert.deepEqual(denseLockBound, { attempts: 3, elapsed_ms: 300 });

console.log(JSON.stringify({scenario: 'phase29_boundary_1024_per_tick', rows: boundaryBefore}));
console.log(JSON.stringify({scenario: 'phase30_boundary_1024_per_tick', rows: boundaryAfter}));
console.log(JSON.stringify({scenario: 'phase29_near_limit_1023_per_tick', rows: nearLimitBefore}));
console.log(JSON.stringify({scenario: 'phase30_near_limit_1023_per_tick', rows: nearLimitAfter}));
console.log(JSON.stringify({scenario: 'phase29_overload_1100_per_tick', rows: overloadBefore}));
console.log(JSON.stringify({scenario: 'phase30_overload_1100_per_tick', rows: overloadAfter}));
console.log(JSON.stringify({
  scenario: 'dense_100ms_lock_waits_under_250ms_cooperative_deadline',
  ...denseLockBound,
}));
console.log(JSON.stringify({
  checks: 'PASS',
  normal_visit_limit: NORMAL_VISIT_LIMIT,
  debt_tick_visit_limit: 1025,
}));
