import assert from 'node:assert/strict';

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const PER_INDEX_DEADLINE_MS = 250;
const TOTAL_RESCUE_DEADLINE_MS = 2 * PER_INDEX_DEADLINE_MS;
const EPSILON_MS = 0.001;
const LATEST_LOCAL_START_MS = PER_INDEX_DEADLINE_MS - EPSILON_MS;
const EQUAL_THRESHOLD_STALL_MS =
  (CLEANUP_INTERVAL_MS - 2 * LATEST_LOCAL_START_MS) / 2;

function simulateTwoFinalCalls({aggregateDeadline, stallMs}) {
  let elapsedMs = 0;
  const calls = [];
  const globalDeadlineAtMs = aggregateDeadline
    ? TOTAL_RESCUE_DEADLINE_MS
    : Number.POSITIVE_INFINITY;

  for (let index = 1; index <= 2; index += 1) {
    const localDeadlineAtMs = elapsedMs + PER_INDEX_DEADLINE_MS;
    const startMs = localDeadlineAtMs - EPSILON_MS;

    if (startMs >= globalDeadlineAtMs) {
      calls.push({
        index,
        authorized: false,
        skipped_by_aggregate_deadline: true,
        elapsed_ms: elapsedMs,
      });
      continue;
    }

    elapsedMs = startMs;
    const finishMs = elapsedMs + stallMs;
    calls.push({
      index,
      authorized: true,
      start_ms: startMs,
      stall_ms: stallMs,
      finish_ms: finishMs,
    });
    elapsedMs = finishMs;
  }

  return {
    aggregate_deadline: aggregateDeadline,
    aggregate_deadline_ms: aggregateDeadline ? TOTAL_RESCUE_DEADLINE_MS : null,
    elapsed_ms: elapsedMs,
    calls,
    authorized_calls: calls.filter((call) => call.authorized).length,
    reaches_next_tick: elapsedMs >= CLEANUP_INTERVAL_MS,
  };
}

const beforeThreshold = simulateTwoFinalCalls({
  aggregateDeadline: false,
  stallMs: EQUAL_THRESHOLD_STALL_MS,
});
const afterThreshold = simulateTwoFinalCalls({
  aggregateDeadline: true,
  stallMs: EQUAL_THRESHOLD_STALL_MS,
});
const beforeFiveMinutesEach = simulateTwoFinalCalls({
  aggregateDeadline: false,
  stallMs: 5 * 60 * 1000,
});
const afterFiveMinutesEach = simulateTwoFinalCalls({
  aggregateDeadline: true,
  stallMs: 5 * 60 * 1000,
});

assert.ok(EQUAL_THRESHOLD_STALL_MS > 299_749);
assert.ok(EQUAL_THRESHOLD_STALL_MS < 299_751);
assert.ok(EQUAL_THRESHOLD_STALL_MS < CLEANUP_INTERVAL_MS);

assert.equal(beforeThreshold.authorized_calls, 2);
assert.equal(beforeThreshold.reaches_next_tick, true);
assert.equal(beforeThreshold.elapsed_ms, CLEANUP_INTERVAL_MS);

assert.equal(afterThreshold.authorized_calls, 1);
assert.equal(afterThreshold.reaches_next_tick, false);
assert.equal(afterThreshold.elapsed_ms, CLEANUP_INTERVAL_MS / 2);

assert.equal(beforeFiveMinutesEach.authorized_calls, 2);
assert.equal(beforeFiveMinutesEach.reaches_next_tick, true);
assert.ok(beforeFiveMinutesEach.elapsed_ms > CLEANUP_INTERVAL_MS);

assert.equal(afterFiveMinutesEach.authorized_calls, 1);
assert.equal(afterFiveMinutesEach.reaches_next_tick, false);
assert.ok(afterFiveMinutesEach.elapsed_ms < CLEANUP_INTERVAL_MS);

console.log(JSON.stringify({
  scenario: 'phase35_two_index_cumulative_overrun',
  cleanup_interval_ms: CLEANUP_INTERVAL_MS,
  per_index_deadline_ms: PER_INDEX_DEADLINE_MS,
  aggregate_call_start_deadline_ms: TOTAL_RESCUE_DEADLINE_MS,
  equal_sub_ten_minute_stall_threshold_ms: EQUAL_THRESHOLD_STALL_MS,
  before_threshold: beforeThreshold,
  after_threshold: afterThreshold,
  before_five_minutes_each: beforeFiveMinutesEach,
  after_five_minutes_each: afterFiveMinutesEach,
  checks: 'PASS',
}));
