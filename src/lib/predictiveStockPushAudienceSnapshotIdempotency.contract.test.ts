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
    const nextFunction = lowerSql.indexOf(
      '\ncreate or replace function ',
      start + needle.length,
    );
    latest = sql.slice(start, nextFunction >= 0 ? nextFunction : sql.length);
  }

  if (!latest) throw new Error(`Function ${schema}.${name} was not found`);
  return latest;
}

const allSql = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort()
  .map((entry) => readFileSync(join(migrationsDir, entry), 'utf8'))
  .join('\n');

const enqueueSql = latestFunctionDefinition('public', 'visionfood_push_predictive_stock');
const outboxEnqueueSql = latestFunctionDefinition(
  'private',
  'visionfood_onesignal_outbox_enqueue',
);

describe('predictive stock push audience snapshot idempotency contract', () => {
  it('persists the organization-scoped subscription snapshot beside the durable mapping', () => {
    expect(allSql).toMatch(
      /onesignal_predictive_push_dedupe[\s\S]*add column if not exists subscription_ids jsonb/i,
    );
    expect(enqueueSql).toMatch(
      /subscription_ids:=private\.visionfood_admin_push_subscription_ids\(_org\)/i,
    );
    expect(enqueueSql).toMatch(
      /insert into private\.onesignal_predictive_push_dedupe[\s\S]*subscription_ids[\s\S]*outbox_id/i,
    );
  });

  it('freezes the exact include_subscription_ids object in the outbox request', () => {
    expect(enqueueSql).toMatch(
      /visionfood_onesignal_outbox_enqueue\([\s\S]*jsonb_build_object\(\s*'include_subscription_ids'[\s\S]*subscription_ids/i,
    );
    expect(outboxEnqueueSql).toContain('existing.audience is distinct from _audience');
    expect(outboxEnqueueSql).toContain('existing.payload is distinct from frozen_payload');
  });

  it('retries the stored outbox request without rebuilding audience from registry state', () => {
    const existingPath = enqueueSql.slice(
      enqueueSql.indexOf('if found then'),
      enqueueSql.indexOf('subscription_ids:=private.visionfood_admin_push_subscription_ids(_org)'),
    );

    expect(existingPath).toContain('previous_outbox_id');
    expect(existingPath).toContain('visionfood_onesignal_outbox_dispatch_one');
    expect(existingPath).not.toContain('visionfood_admin_push_subscription_ids(_org)');
  });

  it('keeps organization-scoped subscription-id targeting only', () => {
    expect(enqueueSql).toContain('include_subscription_ids');
    expect(enqueueSql).not.toMatch(/included_segments|include_aliases|filters/i);
  });
});
