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
const dispatchOneSql = latestFunctionDefinition(
  'private',
  'visionfood_onesignal_outbox_dispatch_one',
);

describe('predictive stock push App ID rotation idempotency contract', () => {
  it('keeps the predictive dedupe row bound to the App ID captured by its outbox', () => {
    expect(allSql).toMatch(
      /onesignal_predictive_push_dedupe[\s\S]*add column if not exists app_id text/i,
    );
    expect(enqueueSql).toMatch(
      /select o\.app_id[\s\S]*from private\.onesignal_outbox o[\s\S]*where o\.id=predictive_outbox_id/i,
    );
  });

  it('captures generation and App ID atomically in the durable enqueue', () => {
    expect(outboxEnqueueSql).toMatch(
      /select s\.config_generation_id,s\.app_id[\s\S]*join private\.onesignal_config_generations/i,
    );
    expect(outboxEnqueueSql).toContain('config_generation_id');
  });

  it('retries with the exact generation and App ID already frozen on the outbox row', () => {
    expect(dispatchOneSql).toContain('claimed_generation_id');
    expect(dispatchOneSql).toContain('claimed_app_id');
    expect(dispatchOneSql).toContain('where g.id=claimed_generation_id');
    expect(dispatchOneSql).toContain('and g.app_id=claimed_app_id');
    expect(enqueueSql).toMatch(
      /previous_outbox_id[\s\S]*visionfood_onesignal_outbox_dispatch_one/i,
    );
  });

  it('does not rebuild ambiguous retry identity from the currently active App ID', () => {
    expect(enqueueSql).not.toContain('previous_app_id');
    expect(enqueueSql).not.toContain('current_app_id');
    expect(enqueueSql).not.toContain('app_rotated_ambiguous_request');
  });
});
