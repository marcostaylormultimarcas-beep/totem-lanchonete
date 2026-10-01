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

function rangeIds(heapPages: number[], pagesPerRange: number): Set<number> {
  return new Set(heapPages.map((page) => Math.floor(page / pagesPerRange)));
}

describe('OneSignal Durable Outbox V2 phase 24 BRIN write/buffer pressure audit', () => {
  const outbox = indexDefinition('onesignal_outbox_health_created_idx');
  const attempts = indexDefinition('onesignal_outbox_attempts_health_created_idx');

  it('quantifies the deliberate 4x summary/autosummarize boundary rate of 8-page ranges', () => {
    const pagesPerRange = optionNumber(outbox, 'pages_per_range');

    expect(pagesPerRange).toBe(8);

    // PostgreSQL keeps one BRIN summary per page range and autosummarize is
    // requested when insertion crosses into the next range. Smaller ranges
    // therefore increase summary cardinality/request opportunities by exactly
    // the inverse range-size ratio, not once per inserted row.
    const heapPages = 3200;
    const currentRanges = summarizedRanges(heapPages, pagesPerRange);
    const old32PageRanges = summarizedRanges(heapPages, 32);

    expect(currentRanges).toBe(400);
    expect(old32PageRanges).toBe(100);
    expect(currentRanges / old32PageRanges).toBe(4);
  });

  it('keeps minmax-multi summary value capacity bounded despite values_per_range=64', () => {
    for (const ddl of [outbox, attempts]) {
      const pagesPerRange = optionNumber(ddl, 'pages_per_range');
      const valuesPerRange = optionNumber(ddl, 'values_per_range');

      expect(pagesPerRange).toBe(8);
      expect(valuesPerRange).toBe(64);

      // timestamptz is an 8-byte value. This is deliberately only the raw
      // value-slot payload bound (BRIN tuple/revmap headers are additional),
      // used to make the storage trade-off explicit without pretending to
      // predict exact on-disk index size.
      const rawSummaryValueBytes = valuesPerRange * 8;
      const heapBytesCovered = pagesPerRange * 8192;

      expect(rawSummaryValueBytes).toBe(512);
      expect(rawSummaryValueBytes / heapBytesCovered).toBeCloseTo(0.0078125, 8);
    }
  });

  it('reduces summary-tuple lock fan-in for reused heap pages versus 32-page ranges', () => {
    // Inserts into an already summarized reused page may need to update that
    // range summary. Eight-page ranges split the same 32 heap pages across
    // four independent summaries instead of concentrating all updates on one.
    const reusedPages = Array.from({ length: 32 }, (_, page) => page);

    expect(rangeIds(reusedPages, 8).size).toBe(4);
    expect(rangeIds(reusedPages, 32).size).toBe(1);
  });

  it('keeps autosummarize enabled without adding synchronous manual summarization to foreground runtime SQL', () => {
    for (const ddl of [outbox, attempts]) {
      expect(ddl).toContain('autosummarize=on');
    }

    // Phase 26 deliberately allows queue-independent summarization only inside
    // the already low-frequency cleanup function. Strip every historical
    // definition of that function, then keep the stronger invariant that no
    // enqueue/claim/reconcile/runner/health (or any other migration SQL) may
    // turn BRIN summarization into foreground work.
    const withoutCleanup = migrationCorpus.replace(
      /create or replace function private\.visionfood_onesignal_outbox_cleanup\([\s\S]*?\$\$;/g,
      '',
    );

    expect(withoutCleanup).not.toMatch(
      /perform\s+pg_catalog\.brin_summarize_(?:range|new_values)\s*\(/,
    );
    expect(withoutCleanup).not.toMatch(
      /select\s+pg_catalog\.brin_summarize_(?:range|new_values)\s*\(/,
    );
  });
});
