import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort();

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
const migrationCorpus = normalize(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .join('\n'),
);

function indexDefinition(name: string): string {
  const needle = `create index if not exists ${name}`;
  const start = migrationCorpus.lastIndexOf(needle);
  if (start < 0) return '';
  const end = migrationCorpus.indexOf(';', start);
  return migrationCorpus.slice(start, end >= 0 ? end + 1 : migrationCorpus.length);
}

function optionNumber(ddl: string, option: string): number {
  const match = ddl.match(new RegExp(`${option}\\s*=\\s*(\\d+)`));
  if (!match) throw new Error(`missing ${option} in BRIN DDL: ${ddl}`);
  return Number(match[1]);
}

function summarizedRanges(heapPages: number, pagesPerRange: number): number {
  return Math.ceil(heapPages / pagesPerRange);
}

function rawSummaryValueBytes(
  heapPages: number,
  pagesPerRange: number,
  valuesPerRange: number,
): number {
  return summarizedRanges(heapPages, pagesPerRange) * valuesPerRange * 8;
}

function plannerMatchedPages(
  heapPages: number,
  pagesPerRange: number,
  qualSelectivity: number,
  correlation: number,
): number {
  const indexRanges = summarizedRanges(heapPages, pagesPerRange);
  const minimalRanges = Math.ceil(indexRanges * qualSelectivity);
  const estimatedRanges =
    correlation < 1e-10
      ? indexRanges
      : Math.min(minimalRanges / correlation, indexRanges);

  // PostgreSQL's BRIN cost model charges bitmap manipulation by the estimated
  // matching range count multiplied by pages_per_range. Keep the same shape
  // here so changing range granularity cannot masquerade as 4x heap work.
  return estimatedRanges * pagesPerRange;
}

describe('OneSignal Durable Outbox V2 phase 25 BRIN read-side cost audit', () => {
  const outbox = indexDefinition('onesignal_outbox_health_created_idx');
  const attempts = indexDefinition('onesignal_outbox_attempts_health_created_idx');

  it('quantifies the 4x full-range/revmap traversal cardinality at pages_per_range=8', () => {
    const pagesPerRange = optionNumber(outbox, 'pages_per_range');
    const heapPages = 3_200_000;

    const currentRanges = summarizedRanges(heapPages, pagesPerRange);
    const old32PageRanges = summarizedRanges(heapPages, 32);

    expect(pagesPerRange).toBe(8);
    expect(currentRanges).toBe(400_000);
    expect(old32PageRanges).toBe(100_000);
    expect(currentRanges / old32PageRanges).toBe(4);
  });

  it('keeps the maximum raw minmax-multi value payload below 1% of heap bytes even at extreme summary cardinality', () => {
    for (const ddl of [outbox, attempts]) {
      const pagesPerRange = optionNumber(ddl, 'pages_per_range');
      const valuesPerRange = optionNumber(ddl, 'values_per_range');
      const heapPages = 3_200_000;

      const rawSummaryBytes = rawSummaryValueBytes(
        heapPages,
        pagesPerRange,
        valuesPerRange,
      );
      const heapBytes = heapPages * 8192;

      expect(pagesPerRange).toBe(8);
      expect(valuesPerRange).toBe(64);
      expect(rawSummaryBytes / heapBytes).toBeCloseTo(0.0078125, 8);
      expect(rawSummaryBytes / heapBytes).toBeLessThan(0.01);
    }
  });

  it('does not turn planner heap-page selectivity into a 4x penalty for the same recent-window fraction', () => {
    const heapPages = 3_200_000;
    const qualSelectivity = 0.01;
    const correlation = 0.8;

    const pagesAt8 = plannerMatchedPages(
      heapPages,
      8,
      qualSelectivity,
      correlation,
    );
    const pagesAt32 = plannerMatchedPages(
      heapPages,
      32,
      qualSelectivity,
      correlation,
    );

    expect(pagesAt8).toBe(40_000);
    expect(pagesAt32).toBe(40_000);
  });

  it('shows why the denser summary traversal remains a read trade-off under sparse page reuse instead of a proven regression', () => {
    const heapPages = 3_200_000;

    // Adversarial retention/page-reuse shape from phase 23 generalized to a
    // large relation: one recent tuple lands in one 8-page subrange inside
    // every old 32-page range. Both indexes match the same count of logical
    // recent-containing ranges, but the 8-page BRIN rechecks only 1/4 as much
    // heap. The extra whole-index summary visits buy eight avoided heap-page
    // rechecks each in this shape.
    const oldMatchingRanges = summarizedRanges(heapPages, 32);
    const currentMatchingRanges = oldMatchingRanges;

    const oldHeapRechecks = oldMatchingRanges * 32;
    const currentHeapRechecks = currentMatchingRanges * 8;
    const extraSummaryVisits =
      summarizedRanges(heapPages, 8) - summarizedRanges(heapPages, 32);
    const avoidedHeapRechecks = oldHeapRechecks - currentHeapRechecks;

    expect(oldHeapRechecks).toBe(3_200_000);
    expect(currentHeapRechecks).toBe(800_000);
    expect(avoidedHeapRechecks / extraSummaryVisits).toBe(8);
  });
});
