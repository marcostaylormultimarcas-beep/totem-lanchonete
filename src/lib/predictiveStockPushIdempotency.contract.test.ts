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

const migrationSql = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort()
  .map((entry) => readFileSync(join(migrationsDir, entry), 'utf8'))
  .join('\n');

const enqueueSql = latestFunctionDefinition('visionfood_push_predictive_stock');
const resultSql = latestFunctionDefinition('visionfood_predictive_push_result');

describe('predictive stock push retry idempotency contract', () => {
  it('persists a OneSignal idempotency UUID for the logical predictive send', () => {
    expect(migrationSql).toMatch(
      /onesignal_predictive_push_dedupe[\s\S]*idempotency_key\s+uuid/i,
    );
    expect(enqueueSql).toMatch(/previous_idempotency_key\s+uuid/i);
    expect(enqueueSql).toMatch(/predictive_idempotency_key\s+uuid/i);
  });

  it('sends the stable idempotency key with include_subscription_ids', () => {
    expect(enqueueSql).toContain('include_subscription_ids');
    expect(enqueueSql).toMatch(
      /include_subscription_ids[\s\S]*idempotency_key[\s\S]*predictive_idempotency_key/i,
    );
    expect(enqueueSql).not.toMatch(/included_segments|include_aliases|filters/i);
  });

  it('reuses the previous key after an ambiguous response instead of minting a new logical send', () => {
    expect(enqueueSql).toMatch(
      /previous_idempotency_key[\s\S]*predictive_idempotency_key\s*:=\s*previous_idempotency_key/i,
    );
    expect(enqueueSql).toMatch(
      /insert\s+into\s+private\.onesignal_predictive_push_dedupe[\s\S]*idempotency_key/i,
    );
  });

  it('keeps ambiguous response_missing state available for a safe same-key retry', () => {
    const marker = resultSql.indexOf("'response_missing'");
    expect(marker).toBeGreaterThan(0);

    const responseMissingPath = resultSql.slice(Math.max(0, marker - 900), marker + 250);
    expect(responseMissingPath).not.toMatch(
      /delete\s+from\s+private\.onesignal_predictive_push_dedupe/i,
    );
  });
});
