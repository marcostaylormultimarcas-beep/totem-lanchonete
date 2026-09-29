import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

function latestFunctionDefinition(schema: string, name: string): string {
  const needle = `create or replace function ${schema}.${name}(`;
  let latest: string | null = null;

  for (const file of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const lowerSql = sql.toLowerCase();
    const start = lowerSql.lastIndexOf(needle.toLowerCase());
    if (start < 0) continue;

    const nextFunction = lowerSql.indexOf('\ncreate or replace function ', start + needle.length);
    latest = sql.slice(start, nextFunction >= 0 ? nextFunction : sql.length);
  }

  if (!latest) throw new Error(`Function ${schema}.${name} was not found in migrations`);
  return latest;
}

const audienceSql = latestFunctionDefinition(
  'private',
  'visionfood_admin_push_subscription_ids',
);
const predictiveSql = latestFunctionDefinition(
  'public',
  'visionfood_push_predictive_stock',
);

describe('predictive stock push admin-audience TOCTOU contract', () => {
  it('holds a write-conflicting registry lock while selecting the authoritative audience', () => {
    expect(audienceSql).toMatch(
      /lock\s+table\s+private\.onesignal_admin_push_subscriptions\s+in\s+share\s+row\s+exclusive\s+mode/i,
    );
  });

  it('takes the registry lock before cleanup or audience reads can observe subscription state', () => {
    const lower = audienceSql.toLowerCase();
    const lockAt = lower.indexOf(
      'lock table private.onesignal_admin_push_subscriptions in share row exclusive mode',
    );
    const deleteAt = lower.indexOf('delete from private.onesignal_admin_push_subscriptions');
    const selectAudienceAt = lower.indexOf('jsonb_agg(s.subscription_id');

    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(lockAt);
    expect(selectAudienceAt).toBeGreaterThan(lockAt);
  });

  it('keeps the audience-selection lock alive through the outer enqueue transaction', () => {
    const lower = predictiveSql.toLowerCase();
    const audienceAt = lower.lastIndexOf(
      'private.visionfood_admin_push_subscription_ids(_org)',
    );
    const queueAt = lower.indexOf('public.visionfood_onesignal_queue(');

    expect(audienceAt).toBeGreaterThanOrEqual(0);
    expect(queueAt).toBeGreaterThan(audienceAt);
    expect(predictiveSql).toContain('include_subscription_ids');
  });
});
