import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

function latestFunctionDefinition(schema: string, name: string, signatureNeedle = ''): string {
  const prefix = `create or replace function ${schema}.${name}(`;
  let latest: string | null = null;

  for (const file of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const lowerSql = sql.toLowerCase();
    let cursor = 0;

    while (true) {
      const start = lowerSql.indexOf(prefix.toLowerCase(), cursor);
      if (start < 0) break;

      const nextFunction = lowerSql.indexOf('\ncreate or replace function ', start + prefix.length);
      const candidate = sql.slice(start, nextFunction >= 0 ? nextFunction : sql.length);

      if (!signatureNeedle || candidate.toLowerCase().includes(signatureNeedle.toLowerCase())) {
        latest = candidate;
      }

      cursor = start + prefix.length;
    }
  }

  if (!latest) throw new Error(`Function ${schema}.${name} was not found in migrations`);
  return latest;
}

const audienceSql = latestFunctionDefinition(
  'private',
  'visionfood_admin_push_subscription_ids',
);
const reconcileSql = latestFunctionDefinition(
  'public',
  'visionfood_reconcile_admin_push_subscription',
  '_app_id text',
);

describe('OneSignal admin registry lock liveness contract', () => {
  it('does not serialize unrelated organizations with a self-exclusive table lock', () => {
    expect(audienceSql).not.toMatch(
      /lock\s+table\s+private\.onesignal_admin_push_subscriptions\s+in\s+share\s+row\s+exclusive\s+mode/i,
    );
  });

  it('holds row-level SHARE locks on the exact audience through the caller transaction', () => {
    expect(audienceSql).toMatch(
      /select\s+s\.subscription_id[\s\S]*?order\s+by\s+s\.subscription_id[\s\S]*?for\s+share\s+of\s+s/i,
    );
  });

  it('pre-locks every existing row reconcile may mutate in subscription order', () => {
    const lower = reconcileSql.toLowerCase();
    const prelockAt = lower.indexOf('order by s.subscription_id');
    const forUpdateAt = lower.indexOf('for update', prelockAt);
    const deleteAt = lower.indexOf('delete from private.onesignal_admin_push_subscriptions');

    expect(prelockAt).toBeGreaterThanOrEqual(0);
    expect(forUpdateAt).toBeGreaterThan(prelockAt);
    expect(deleteAt).toBeGreaterThan(forUpdateAt);
  });
});
