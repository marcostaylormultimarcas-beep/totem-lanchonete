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

function touchedPages(
  pagesPerRange: number,
  recentHeapPages: number[],
): number {
  return new Set(
    recentHeapPages.map((page) => Math.floor(page / pagesPerRange)),
  ).size * pagesPerRange;
}

describe('OneSignal Durable Outbox V2 phase 23 BRIN retention/page-reuse stability', () => {
  it('proves sparse page reuse can turn 32-page minmax ranges into near-table scans', () => {
    // 100 recent tuples reused into one old page per 32-page range:
    // only 3.125% of heap pages contain recent tuples, but a 32-page BRIN
    // must recheck every page in the relation.
    const recentPages = Array.from({ length: 100 }, (_, i) => i * 32);

    expect(touchedPages(32, recentPages)).toBe(3200);
    expect(touchedPages(8, recentPages)).toBe(800);
  });

  it('uses minmax-multi so reused old ranges do not collapse old+new timestamps into one giant interval', () => {
    const outbox = indexDefinition('onesignal_outbox_health_created_idx');
    const attempts = indexDefinition(
      'onesignal_outbox_attempts_health_created_idx',
    );

    expect(outbox).toMatch(
      /using brin\s*\(created_at timestamptz_minmax_multi_ops\(values_per_range=64\)\)/,
    );
    expect(attempts).toMatch(
      /using brin\s*\(created_at timestamptz_minmax_multi_ops\(values_per_range=64\)\)/,
    );
  });

  it('caps lossy heap rechecks to small ranges while keeping automatic summarization', () => {
    const outbox = indexDefinition('onesignal_outbox_health_created_idx');
    const attempts = indexDefinition(
      'onesignal_outbox_attempts_health_created_idx',
    );

    for (const ddl of [outbox, attempts]) {
      expect(ddl).toContain('pages_per_range=8');
      expect(ddl).toContain('autosummarize=on');
    }
  });

  it('does not fall back to a per-row created_at B-tree', () => {
    const outbox = indexDefinition('onesignal_outbox_health_created_idx');
    const attempts = indexDefinition(
      'onesignal_outbox_attempts_health_created_idx',
    );

    expect(outbox).toContain('using brin');
    expect(attempts).toContain('using brin');
    expect(outbox).not.toMatch(/on private\.onesignal_outbox\s*\(created_at/);
    expect(attempts).not.toMatch(
      /on private\.onesignal_outbox_attempts\s*\(created_at/,
    );
  });
});
