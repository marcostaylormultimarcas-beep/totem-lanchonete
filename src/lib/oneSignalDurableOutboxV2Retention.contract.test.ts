import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort();

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');

const allMigrations = normalize(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .join('\n'),
);

function latestFunctionDefinition(schema: string, name: string): string {
  const needle = `create or replace function ${schema}.${name}(`;
  let latest = '';

  for (const file of migrationFiles) {
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

  return normalize(latest);
}

describe('OneSignal Durable Outbox V2 phase 9 retention safety', () => {
  it('requires an operational cleanup function instead of unbounded durable history', () => {
    expect(allMigrations).toContain(
      'create or replace function private.visionfood_onesignal_outbox_cleanup(',
    );
    expect(allMigrations).toContain(
      "'visionfood-onesignal-outbox-v2-cleanup'",
    );
  });

  it('never deletes pending, sending or retry rows and retains terminal rows for a hard minimum horizon', () => {
    const cleanup = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_cleanup',
    );

    expect(cleanup).not.toBe('');
    expect(cleanup).toContain("o.status in ('delivered','failed')");
    expect(cleanup).toContain("interval '30 days'");
    expect(cleanup).toContain('x.result_observed_at is null');
    expect(cleanup).toContain('net.http_request_queue');
  });

  it('keeps unresolved late-response attempts until pg_net can no longer surface the request or response', () => {
    const cleanup = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_cleanup',
    );

    expect(cleanup).toContain("current_setting('pg_net.ttl',true)");
    expect(cleanup).toContain("interval '24 hours'");
    expect(cleanup).toContain('net._http_response');
    expect(cleanup).toContain("'late_response_window_expired'");
    expect(cleanup).toContain('result_observed_at=pg_catalog.clock_timestamp()');
  });

  it('retires generations only when settings/outbox no longer reference them and only then deletes owned Vault secrets', () => {
    const cleanup = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_cleanup',
    );

    expect(cleanup).toContain("interval '45 days'");
    expect(cleanup).toContain('from private.onesignal_settings s');
    expect(cleanup).toContain('s.config_generation_id=g.id');
    expect(cleanup).toContain('from private.onesignal_outbox o');
    expect(cleanup).toContain('o.config_generation_id=g.id');
    expect(cleanup).toContain('delete from private.onesignal_config_generations');
    expect(cleanup).toContain('delete from vault.secrets');
    expect(cleanup).toContain("'onesignal_api_key::global::'||g.id::text");
  });
});
