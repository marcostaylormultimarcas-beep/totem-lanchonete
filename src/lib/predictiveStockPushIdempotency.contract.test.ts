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

describe('predictive stock push durable idempotency contract', () => {
  it('persists the OneSignal idempotency UUID beside the durable outbox mapping', () => {
    expect(migrationSql).toMatch(
      /onesignal_predictive_push_dedupe[\s\S]*idempotency_key\s+uuid/i,
    );
    expect(migrationSql).toMatch(
      /onesignal_predictive_push_dedupe[\s\S]*outbox_id\s+uuid/i,
    );
    expect(enqueueSql).toMatch(/predictive_idempotency_key\s+uuid/i);
  });

  it('freezes idempotency key and include_subscription_ids together at outbox enqueue', () => {
    expect(enqueueSql).toMatch(
      /visionfood_onesignal_outbox_enqueue\([\s\S]*include_subscription_ids[\s\S]*predictive_idempotency_key/i,
    );
    expect(enqueueSql).not.toMatch(/included_segments|include_aliases|filters/i);
  });

  it('retries by dispatching the same outbox row instead of minting another logical request', () => {
    expect(enqueueSql).toMatch(
      /outbox_status in \('pending','retry'\)[\s\S]*visionfood_onesignal_outbox_dispatch_one\([\s\S]*previous_outbox_id/i,
    );
    expect(enqueueSql).toMatch(
      /outbox_status in \('pending','sending','retry'\)[\s\S]*return jsonb_build_object/i,
    );
  });

  it('keeps result lookup bound to the same durable outbox identity', () => {
    expect(resultSql).toMatch(
      /d\.request_id=_request_id[\s\S]*predictive_outbox_id/i,
    );
    expect(resultSql).toMatch(
      /where o\.id=predictive_outbox_id[\s\S]*o\.organization_id=_org[\s\S]*o\.push_type='predictive_stock'/i,
    );
  });

  it('never reads pg_net response/queue tables to decide predictive retry identity', () => {
    for (const sql of [enqueueSql, resultSql]) {
      expect(sql).not.toContain('net._http_response');
      expect(sql).not.toContain('net.http_request_queue');
    }
  });
});
