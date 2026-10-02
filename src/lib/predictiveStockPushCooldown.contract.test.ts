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
const resultSql = latestFunctionDefinition('visionfood_predictive_push_result');

describe('predictive stock push persistent cooldown contract', () => {
  it('persists predictive domain dedupe outside the browser lifecycle', () => {
    expect(allSql).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+private\.onesignal_predictive_push_dedupe/i,
    );
    expect(allSql).toMatch(
      /primary\s+key\s*\(\s*organization_id\s*,\s*ingredient_key\s*,\s*days_remaining\s*\)/i,
    );
    expect(allSql).toMatch(
      /onesignal_predictive_push_dedupe[\s\S]*add column if not exists outbox_id uuid/i,
    );
  });

  it('serializes concurrent callers before checking the cooldown', () => {
    expect(enqueueSql).toMatch(
      /pg_advisory_xact_lock[\s\S]*onesignal_predictive_push_dedupe/i,
    );
  });

  it('uses the 24-hour cooldown only after durable delivery was confirmed', () => {
    expect(enqueueSql).toMatch(
      /outbox_status='delivered'[\s\S]*last_confirmed_at[\s\S]*interval '24 hours'/i,
    );
    expect(enqueueSql).toMatch(
      /'delivered',true[\s\S]*'deduplicated',true/i,
    );
  });

  it('keeps a non-terminal logical send deduplicated on the same outbox row', () => {
    expect(enqueueSql).toMatch(
      /outbox_status in \('pending','sending','retry'\)[\s\S]*'pending',true[\s\S]*'deduplicated',true/i,
    );
    expect(enqueueSql).toContain('previous_outbox_id');
  });

  it('does not use pg_net transport tables as predictive state', () => {
    for (const sql of [enqueueSql, resultSql]) {
      expect(sql).not.toContain('net._http_response');
      expect(sql).not.toContain('net.http_request_queue');
      expect(sql).toContain('private.onesignal_outbox');
    }
  });

  it('preserves pre-cutover rows fail-closed for the existing cooldown horizon', () => {
    expect(enqueueSql).toContain('legacy_request_cooldown');
    expect(enqueueSql).toMatch(
      /previous_outbox_id is null[\s\S]*interval '24 hours'/i,
    );
  });

  it('keeps the result RPC tenant-scoped and non-public', () => {
    expect(resultSql).toContain('public.usuario_dono_org(_org,u)');
    expect(allSql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.visionfood_predictive_push_result\(uuid,bigint\)[\s\S]*from\s+public,anon/i,
    );
  });
});
