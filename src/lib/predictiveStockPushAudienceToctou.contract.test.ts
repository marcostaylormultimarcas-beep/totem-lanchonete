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
  it('locks the exact authoritative audience rows instead of the whole registry table', () => {
    expect(audienceSql).not.toMatch(
      /lock\s+table\s+private\.onesignal_admin_push_subscriptions\s+in\s+share\s+row\s+exclusive\s+mode/i,
    );
    expect(audienceSql).toMatch(
      /select\s+s\.subscription_id[\s\S]*?order\s+by\s+s\.subscription_id[\s\S]*?for\s+share\s+of\s+s/i,
    );
  });

  it('filters the locked rows by organization, current App ID and TTL before aggregation', () => {
    expect(audienceSql).toContain('s.organization_id=_org');
    expect(audienceSql).toContain('s.app_id=configured_app_id');
    expect(audienceSql).toContain(
      "s.updated_at > pg_catalog.clock_timestamp() - interval '30 days'",
    );
    expect(audienceSql).toMatch(
      /jsonb_agg\(locked\.subscription_id\s+order\s+by\s+locked\.subscription_id\)/i,
    );
  });

  it('keeps the audience-selection row locks alive through the outer enqueue transaction', () => {
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
