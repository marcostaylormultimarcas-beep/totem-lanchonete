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

describe('predictive stock push audience snapshot idempotency contract', () => {
  it('persists the exact subscription-id audience that belongs to the logical OneSignal request', () => {
    expect(allSql).toMatch(
      /onesignal_predictive_push_dedupe[\s\S]*add column if not exists subscription_ids jsonb/i,
    );
    expect(enqueueSql).toMatch(/previous_subscription_ids\s+jsonb/i);
    expect(enqueueSql).toMatch(
      /select[\s\S]*d\.subscription_ids[\s\S]*into[\s\S]*previous_subscription_ids/i,
    );
    expect(enqueueSql).toMatch(
      /insert\s+into\s+private\.onesignal_predictive_push_dedupe[\s\S]*subscription_ids[\s\S]*idempotency_key/i,
    );
  });

  it('reuses the stored audience whenever it reuses an ambiguous request idempotency key', () => {
    expect(enqueueSql).toMatch(
      /predictive_idempotency_key\s*:=\s*previous_idempotency_key\s*;[\s\S]*subscription_ids\s*:=\s*previous_subscription_ids\s*;/i,
    );
    expect(enqueueSql).toMatch(
      /if\s+subscription_ids\s+is\s+null\s+then[\s\S]*visionfood_admin_push_subscription_ids\(_org\)/i,
    );
  });

  it('never reconstructs an unknown legacy audience for an ambiguous same-App retry', () => {
    expect(enqueueSql).toContain('legacy_audience_ambiguous_request');
  });

  it('keeps organization-scoped subscription-id targeting', () => {
    expect(enqueueSql).toContain('include_subscription_ids');
    expect(enqueueSql).toContain('private.visionfood_admin_push_subscription_ids(_org)');
    expect(enqueueSql).not.toMatch(/included_segments|include_aliases|filters/i);
  });
});
