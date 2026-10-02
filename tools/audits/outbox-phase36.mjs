import assert from 'node:assert/strict';

const PER_INDEX_DEADLINE_MS = 250;
const TOTAL_RESCUE_DEADLINE_MS = 500;
const EPSILON_MS = 0.001;
const FINAL_CALL_POST_START_MS = 250.002;
const TICKS = 8;

function orderForTick(tick, rotating) {
  if (!rotating || tick % 2 === 0) return [0, 1];
  return [1, 0];
}

function simulate(rotating) {
  const opportunities = [0, 0];
  const skippedAsSecond = [0, 0];
  const traces = [];

  for (let tick = 0; tick < TICKS; tick += 1) {
    const order = orderForTick(tick, rotating);
    const firstStartMs = PER_INDEX_DEADLINE_MS - EPSILON_MS;
    const firstFinishMs = firstStartMs + FINAL_CALL_POST_START_MS;
    const aggregateExpired = firstFinishMs >= TOTAL_RESCUE_DEADLINE_MS;

    opportunities[order[0]] += 1;
    if (aggregateExpired) skippedAsSecond[order[1]] += 1;
    else opportunities[order[1]] += 1;

    traces.push({
      tick: tick + 1,
      order,
      first_start_ms: firstStartMs,
      first_finish_ms: firstFinishMs,
      aggregate_expired_before_second: aggregateExpired,
    });
  }

  return { opportunities, skipped_as_second: skippedAsSecond, traces };
}

const before = simulate(false);
const after = simulate(true);
const firstFinishMs =
  PER_INDEX_DEADLINE_MS - EPSILON_MS + FINAL_CALL_POST_START_MS;

assert.ok(firstFinishMs > TOTAL_RESCUE_DEADLINE_MS);
assert.ok(firstFinishMs < 501);
assert.deepEqual(before.opportunities, [TICKS, 0]);
assert.deepEqual(before.skipped_as_second, [0, TICKS]);
assert.deepEqual(after.opportunities, [TICKS / 2, TICKS / 2]);
assert.deepEqual(after.skipped_as_second, [TICKS / 2, TICKS / 2]);

console.log(JSON.stringify({
  scenario: 'phase36_aggregate_envelope_cross_index_fairness',
  per_index_deadline_ms: PER_INDEX_DEADLINE_MS,
  aggregate_call_start_deadline_ms: TOTAL_RESCUE_DEADLINE_MS,
  final_call_post_start_ms: FINAL_CALL_POST_START_MS,
  first_index_finish_ms: firstFinishMs,
  sustained_ticks: TICKS,
  before_fixed_order: before,
  after_rotating_order: after,
  checks: 'PASS',
}));
