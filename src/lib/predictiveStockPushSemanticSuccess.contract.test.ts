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

const enqueueSql = latestFunctionDefinition('public', 'visionfood_push_predictive_stock');
const resultSql = latestFunctionDefinition('public', 'visionfood_predictive_push_result');
const reconcileSql = latestFunctionDefinition('private', 'visionfood_onesignal_outbox_reconcile');

describe('predictive stock push OneSignal semantic success contract', () => {
  it('centralizes semantic HTTP success in the durable outbox reconciler', () => {
    expect(reconcileSql).toMatch(/response_status>=200[\s\S]*response_status<300/i);
    expect(reconcileSql).toContain("response_payload->>'id'");
    expect(reconcileSql).toContain("semantic_outcome='delivered'");
    expect(reconcileSql).toContain("set status='delivered'");
  });

  it('public predictive RPCs trust only durable delivered/failed state', () => {
    expect(enqueueSql).toMatch(
      /outbox_status='delivered'[\s\S]*'delivered',true/i,
    );
    expect(resultSql).toMatch(
      /outbox_status='delivered'[\s\S]*'delivered',true/i,
    );
    expect(resultSql).toMatch(
      /outbox_status='failed'[\s\S]*'failed',true/i,
    );
    for (const sql of [enqueueSql, resultSql]) {
      expect(sql).not.toContain('net._http_response');
    }
  });

  it('keeps predictive push targeting isolated by include_subscription_ids', () => {
    expect(enqueueSql).toContain('include_subscription_ids');
    expect(enqueueSql).not.toMatch(/included_segments|include_aliases|filters/i);
  });
});
