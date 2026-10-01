import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort();

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');

const migrationCorpus = normalize(
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

describe('OneSignal Durable Outbox V2 phase 22 observability write amplification', () => {
  it('does not index the every-update outbox.updated_at progress field', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(migrationCorpus).not.toContain(
      'onesignal_outbox_health_progress_idx',
    );
    expect(migrationCorpus).toMatch(
      /onesignal_outbox_health_attempted_idx[^;]*last_attempt_at/,
    );
    expect(health).toContain('o.last_attempt_at');
  });

  it('uses BRIN for append-correlated recent created_at windows', () => {
    expect(migrationCorpus).toMatch(
      /onesignal_outbox_health_created_idx[^;]*using brin\s*\(created_at\b/,
    );
    expect(migrationCorpus).toMatch(
      /onesignal_outbox_attempts_health_created_idx[^;]*using brin\s*\(created_at\b/,
    );
  });

  it('does not duplicate the existing unresolved-attempt partial index', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(migrationCorpus).not.toContain(
      'onesignal_outbox_attempts_health_unresolved_idx',
    );
    expect(migrationCorpus).toContain(
      'onesignal_outbox_attempts_unresolved_idx',
    );
    expect(health).toMatch(
      /where x\.result_observed_at is null and x\.pg_net_request_id is not null/,
    );
  });

  it('keeps selective terminal and cron-history B-tree access paths', () => {
    expect(migrationCorpus).toContain('onesignal_outbox_health_failed_idx');
    expect(migrationCorpus).toContain('onesignal_outbox_health_delivered_idx');
    expect(migrationCorpus).toMatch(
      /visionfood_onesignal_cron_history_job_start_idx[^;]*\(jobid,start_time desc,runid desc\)/,
    );
  });
});
