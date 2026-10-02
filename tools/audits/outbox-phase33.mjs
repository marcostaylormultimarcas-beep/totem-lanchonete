import assert from 'node:assert/strict';

const DEADLINE_MS = 250;
const CALL_MS = 0.2442;
const PAGES_PER_RANGE = 8;
const PAGE_BYTES = 8192;
const TICKS_PER_DAY = 144;

function simulate(arrivals, callMs = CALL_MS) {
  let backlog = 0;
  let historyDue = false;
  const rows = [];

  for (let tick = 0; tick < arrivals.length; tick += 1) {
    backlog += arrivals[tick];
    let elapsedMs = 0;
    let visits = 0;
    let tailVisits = 0;
    let historyVisits = 0;
    let visitLimit = 1024;

    if (historyDue && elapsedMs < DEADLINE_MS) {
      visitLimit = 1025;
      elapsedMs += callMs;
      visits += 1;
      historyVisits += 1;
    }

    while (
      backlog > 0 &&
      visits < visitLimit &&
      elapsedMs < DEADLINE_MS
    ) {
      elapsedMs += callMs;
      visits += 1;
      tailVisits += 1;
      backlog -= 1;
    }

    historyDue = historyVisits === 0;
    rows.push({
      tick: tick + 1,
      arrivals: arrivals[tick],
      tail_visits: tailVisits,
      history_visits: historyVisits,
      backlog,
      history_due: historyDue,
      elapsed_ms: Number(elapsedMs.toFixed(4)),
    });
  }

  return rows;
}

const fullDebtTailThresholdMs = DEADLINE_MS / 1024;
const fullNormalTailThresholdMs = DEADLINE_MS / 1023;
const bandWidthRatio =
  (fullNormalTailThresholdMs - fullDebtTailThresholdMs) /
  fullDebtTailThresholdMs;

const day = simulate(Array.from({length: TICKS_PER_DAY}, () => 1024));
const week = simulate(Array.from({length: TICKS_PER_DAY * 7}, () => 1024));
const oneNominalTick = simulate(Array.from({length: 2048}, () => 1024));
const halfRangeHeadroom = simulate(
  Array.from({length: TICKS_PER_DAY / 2}, () => [1024, 1023]).flat(),
);

const backlogRangesDay = day.at(-1).backlog;
const backlogRangesWeek = week.at(-1).backlog;
const backlogBytesDay = backlogRangesDay * PAGES_PER_RANGE * PAGE_BYTES;
const backlogBytesWeek = backlogRangesWeek * PAGES_PER_RANGE * PAGE_BYTES;
const nominalBytesDay =
  1024 * TICKS_PER_DAY * PAGES_PER_RANGE * PAGE_BYTES;

assert.ok(bandWidthRatio < 0.001);
assert.equal(backlogRangesDay, 72);
assert.equal(backlogRangesWeek, 504);
assert.equal(backlogBytesDay, 4.5 * 1024 * 1024);
assert.equal(backlogBytesWeek, 31.5 * 1024 * 1024);
assert.equal(oneNominalTick.at(-1).backlog, 1024);
assert.equal(halfRangeHeadroom.at(-1).backlog, 0);

console.log(JSON.stringify({
  scenario: 'phase33_just_binding_operational_backlog',
  call_time_band_ms: {
    full_1024_tail_on_debt_tick_below: fullDebtTailThresholdMs,
    full_1024_tail_on_normal_tick_below: fullNormalTailThresholdMs,
    relative_width_percent: bandWidthRatio * 100,
  },
  sustained_1024_per_tick: {
    backlog_ranges_24h: backlogRangesDay,
    backlog_heap_mib_24h: backlogBytesDay / 1024 / 1024,
    backlog_ranges_7d: backlogRangesWeek,
    backlog_heap_mib_7d: backlogBytesWeek / 1024 / 1024,
    nominal_heap_growth_gib_24h: nominalBytesDay / 1024 / 1024 / 1024,
    backlog_fraction_percent:
      (backlogRangesDay / (1024 * TICKS_PER_DAY)) * 100,
    ticks_to_one_nominal_1024_range_rescue_budget: 2048,
    days_to_one_nominal_1024_range_rescue_budget: 2048 / TICKS_PER_DAY,
  },
  headroom_probe: {
    pattern: [1024, 1023],
    average_arrivals_per_tick: 1023.5,
    ending_backlog: halfRangeHeadroom.at(-1).backlog,
  },
  checks: 'PASS',
}));
