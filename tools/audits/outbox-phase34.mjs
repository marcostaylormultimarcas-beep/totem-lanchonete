import assert from 'node:assert/strict';

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const COOPERATIVE_DEADLINE_MS = 250;
const EPSILON_MS = 0.001;
const LATEST_LEGITIMATE_START_MS = COOPERATIVE_DEADLINE_MS - EPSILON_MS;
const REQUIRED_SINGLE_CALL_STALL_MS = CLEANUP_INTERVAL_MS - LATEST_LEGITIMATE_START_MS;

function simulateSingleAuthorizedCall(ioMs) {
  const startMs = LATEST_LEGITIMATE_START_MS;
  const finishMs = startMs + ioMs;
  return {
    startMs,
    ioMs,
    finishMs,
    reachesNextScheduledTick: finishMs >= CLEANUP_INTERVAL_MS,
    retentionCommitDelayedMs: ioMs,
  };
}

const fast = simulateSingleAuthorizedCall(300);
const fiveMinutes = simulateSingleAuthorizedCall(5 * 60 * 1000);
const threshold = simulateSingleAuthorizedCall(REQUIRED_SINGLE_CALL_STALL_MS);
const tenMinutes = simulateSingleAuthorizedCall(10 * 60 * 1000);

assert.equal(fast.reachesNextScheduledTick, false);
assert.equal(fiveMinutes.reachesNextScheduledTick, false);
assert.equal(threshold.reachesNextScheduledTick, true);
assert.equal(tenMinutes.reachesNextScheduledTick, true);
assert.ok(REQUIRED_SINGLE_CALL_STALL_MS > 599_749);
assert.ok(REQUIRED_SINGLE_CALL_STALL_MS < 599_751);

console.log(JSON.stringify({
  scenario: 'phase34_single_call_residual_overrun_threshold',
  cleanup_interval_ms: CLEANUP_INTERVAL_MS,
  cooperative_deadline_ms: COOPERATIVE_DEADLINE_MS,
  latest_legitimate_call_start_ms: LATEST_LEGITIMATE_START_MS,
  required_single_call_stall_ms: REQUIRED_SINGLE_CALL_STALL_MS,
  required_single_call_stall_seconds: REQUIRED_SINGLE_CALL_STALL_MS / 1000,
  samples: { fast, fiveMinutes, threshold, tenMinutes },
  checks: 'PASS',
}));
