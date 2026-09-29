import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

function latestFunctionDefinition(name: string): string {
  const needle = `create or replace function public.${name}(`;
  let latest: string | null = null;

  for (const file of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const lowerSql = sql.toLowerCase();
    const start = lowerSql.lastIndexOf(needle.toLowerCase());
    if (start < 0) continue;

    const nextFunction = lowerSql.indexOf(
      '\ncreate or replace function public.',
      start + needle.length,
    );
    latest = sql.slice(start, nextFunction >= 0 ? nextFunction : sql.length);
  }

  if (!latest) throw new Error(`Function ${name} was not found in migrations`);
  return latest;
}

const enqueueSql = latestFunctionDefinition('visionfood_push_predictive_stock');
const resultSql = latestFunctionDefinition('visionfood_predictive_push_result');

describe('predictive stock push OneSignal semantic success contract', () => {
  it('does not confirm a 2xx response unless OneSignal returned a non-empty notification id', () => {
    for (const sql of [enqueueSql, resultSql]) {
      expect(sql).toMatch(/net\._http_response[\s\S]*\.content/i);
      expect(sql).toMatch(/response_(body|payload)/i);
      expect(sql).toMatch(/->>\s*'id'/i);
      expect(sql).toMatch(/nullif\s*\(\s*btrim\s*\([^)]*->>\s*'id'/i);
    }
  });

  it('releases dedupe after a semantically unsuccessful 2xx response', () => {
    for (const sql of [enqueueSql, resultSql]) {
      expect(sql).toMatch(
        /response_status\s*>=\s*200[\s\S]*response_status\s*<\s*300[\s\S]*delete\s+from\s+private\.onesignal_predictive_push_dedupe/i,
      );
    }
  });

  it('keeps predictive push targeting isolated by include_subscription_ids', () => {
    expect(enqueueSql).toContain('include_subscription_ids');
    expect(enqueueSql).not.toMatch(/included_segments|include_aliases|filters/i);
  });
});
