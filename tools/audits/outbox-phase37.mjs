import assert from 'node:assert/strict';

const QUEUED_START_BUCKETS = [2, 2, 2, 2, 4, 4, 4, 4];

function firstForWallClockBucket(bucket) {
  return bucket % 2 === 0 ? 0 : 1;
}

function firstForExecutionSequence(execution) {
  return execution % 2 === 0 ? 0 : 1;
}

function opportunities(firstIndexes) {
  const result = [0, 0];
  for (const first of firstIndexes) result[first] += 1;
  return result;
}

const wallClockFirst = QUEUED_START_BUCKETS.map(firstForWallClockBucket);
const sequenceFirst = QUEUED_START_BUCKETS.map((_, execution) =>
  firstForExecutionSequence(execution),
);

const before = opportunities(wallClockFirst);
const sequenceReference = opportunities(sequenceFirst);

assert.deepEqual(before, [8, 0]);
assert.deepEqual(sequenceReference, [4, 4]);
assert.equal(new Set(QUEUED_START_BUCKETS.map((bucket) => bucket % 2)).size, 1);

console.log(JSON.stringify({
  scenario: 'phase37_queued_cleanup_bucket_aliasing',
  queued_start_buckets: QUEUED_START_BUCKETS,
  phase36_wall_clock_first_indexes: wallClockFirst,
  phase36_wall_clock_opportunities: before,
  execution_sequence_reference_first_indexes: sequenceFirst,
  execution_sequence_reference_opportunities: sequenceReference,
  regression: 'PROVEN',
}));
