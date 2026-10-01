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
  const needle = 'create index if not exists ' + name;
  const start = migrationCorpus.lastIndexOf(needle);
  if (start < 0) return '';
  const end = migrationCorpus.indexOf(';', start);
  return migrationCorpus.slice(start, end >= 0 ? end + 1 : migrationCorpus.length);
}

function optionNumber(ddl: string, option: string): number {
  const match = ddl.match(new RegExp(option + '\\s*=\\s*(\\d+)'));
  if (!match) throw new Error('missing ' + option + ' in BRIN DDL: ' + ddl);
  return Number(match[1]);
}

function latestFunctionDefinition(schema: string, name: string): string {
  const needle = 'create or replace function ' + schema + '.' + name + '(';
  let latest = '';

  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const lowerSql = sql.toLowerCase();
    const start = lowerSql.lastIndexOf(needle.toLowerCase());
    if (start < 0) continue;

    const nextFunction = lowerSql.indexOf(
      '\ncreate or replace function ',
      start + needle.length,
    );

    latest = sql.slice(start, nextFunction >= 0 ? nextFunction : sql.length);
  }

  return normalize(latest);
}

function queueCoveredHeapPages(workItems: number, pagesPerRange: number): number {
  return workItems * pagesPerRange;
}

function unsummarizedBitmapPages(
  relationPages: number,
  unsummarizedHeapPages: number,
  pagesPerRange: number,
): number {
  const ranges = Math.ceil(unsummarizedHeapPages / pagesPerRange);
  return Math.min(relationPages, ranges * pagesPerRange);
}

describe('OneSignal Durable Outbox V2 phase 26 BRIN unsummarized burst audit', () => {
  const outbox = indexDefinition('onesignal_outbox_health_created_idx');
  const attempts = indexDefinition('onesignal_outbox_attempts_health_created_idx');

  it('quantifies the 4x autosummarize work-item coverage regression of pages_per_range=8', () => {
    const pagesPerRange = optionNumber(outbox, 'pages_per_range');
    const workItemSlots = 256;

    expect(pagesPerRange).toBe(8);
    expect(queueCoveredHeapPages(workItemSlots, pagesPerRange)).toBe(2_048);
    expect(queueCoveredHeapPages(workItemSlots, 32)).toBe(8_192);
    expect(
      queueCoveredHeapPages(workItemSlots, 32) /
        queueCoveredHeapPages(workItemSlots, pagesPerRange),
    ).toBe(4);
  });

  it('shows an unsummarized burst can make both 5m and 24h created_at scans approach a seq scan', () => {
    const pagesPerRange = optionNumber(outbox, 'pages_per_range');
    const relationPages = 100_000;
    const burstPages = 90_000;

    const bitmapPages = unsummarizedBitmapPages(
      relationPages,
      burstPages,
      pagesPerRange,
    );

    // BRIN returns every page in an unsummarized range regardless of scan keys.
    // Therefore both recent created_at health windows must recheck the same
    // unsummarized tail until summarization catches up.
    expect(bitmapPages).toBe(90_000);
    expect(bitmapPages / relationPages).toBe(0.9);
  });

  it('shows queue overflow leaves 4x less heap coverage recoverable by one full 256-item drain than the old 32-page ranges', () => {
    const pagesPerRange = optionNumber(outbox, 'pages_per_range');
    const workItemSlots = 256;

    const currentCovered = queueCoveredHeapPages(workItemSlots, pagesPerRange);
    const oldCovered = queueCoveredHeapPages(workItemSlots, 32);

    expect(currentCovered).toBe(2_048);
    expect(oldCovered).toBe(8_192);
    expect(oldCovered - currentCovered).toBe(6_144);
  });

  it('requires a queue-independent low-frequency rescue for both BRIN indexes', () => {
    const cleanup = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_cleanup',
    );

    expect(cleanup).not.toBe('');
    expect(cleanup).toContain("'private.onesignal_outbox_health_created_idx'");
    expect(cleanup).toContain("'private.onesignal_outbox_attempts_health_created_idx'");
    expect(cleanup).toContain('brin_summarize_range(rescue_index,rescue_page)');
    expect(cleanup).toContain('private.onesignal_brin_rescue_cursor');

    // The existing cleanup job is deliberately low-frequency and therefore
    // gives dropped autosummarize requests an incremental, queue-independent retry
    // path without putting heap summarization on the foreground 15s runner.
    expect(migrationCorpus).toContain(
      "'visionfood-onesignal-outbox-v2-cleanup', '*/10 * * * *'",
    );
  });

  it('keeps both BRINs autosummarized and avoids foreground manual summarization', () => {
    for (const ddl of [outbox, attempts]) {
      expect(ddl).toContain('autosummarize=on');
    }

    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(health).not.toMatch(/brin_summarize_(?:range|new_values)/);
  });
});
