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

const allSql = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort()
  .map((entry) => readFileSync(join(migrationsDir, entry), 'utf8'))
  .join('\n');

const enqueueSql = latestFunctionDefinition('visionfood_push_predictive_stock');

describe('predictive stock push App ID rotation idempotency contract', () => {
  it('binds every predictive logical send to the OneSignal App ID that created it', () => {
    expect(allSql).toMatch(
      /onesignal_predictive_push_dedupe[\s\S]*add column if not exists app_id text/i,
    );
    expect(enqueueSql).toMatch(/previous_app_id\s+text/i);
    expect(enqueueSql).toMatch(/current_app_id\s+text/i);
  });

  it('locks and reads the current App ID before deciding whether an old ambiguous request is retryable', () => {
    expect(enqueueSql).toMatch(
      /from\s+private\.onesignal_settings[\s\S]*for\s+share/i,
    );
    expect(enqueueSql).toMatch(
      /select[\s\S]*d\.app_id[\s\S]*into[\s\S]*previous_app_id/i,
    );
  });

  it('never reuses an App A idempotency key in App B after rotation while the old result is ambiguous', () => {
    expect(enqueueSql).toContain('app_rotated_ambiguous_request');
    expect(enqueueSql).toMatch(
      /previous_app_id[\s\S]*is distinct from[\s\S]*current_app_id[\s\S]*app_rotated_ambiguous_request/i,
    );
  });

  it('preserves subscription-id targeting and persists the App ID with the idempotency key', () => {
    expect(enqueueSql).toContain('include_subscription_ids');
    expect(enqueueSql).not.toMatch(/included_segments|include_aliases|filters/i);
    expect(enqueueSql).toMatch(
      /insert\s+into\s+private\.onesignal_predictive_push_dedupe[\s\S]*app_id[\s\S]*idempotency_key/i,
    );
  });
});
