import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort();

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');

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

const migrationCorpus = normalize(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .join('\n'),
);

describe('OneSignal Durable Outbox V2 phase 21 health execution cost', () => {
  it('does not aggregate the entire outbox relation in one unqualified scan', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(health).not.toBe('');
    expect(health).not.toMatch(/from private\.onesignal_outbox o\s*;/);
  });

  it('does not aggregate the entire attempts relation in one unqualified scan', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(health).not.toMatch(/from private\.onesignal_outbox_attempts x\s*;/);
    expect(migrationCorpus).toContain(
      'onesignal_outbox_attempts_health_created_idx',
    );
    expect(migrationCorpus).toContain(
      'onesignal_outbox_attempts_unresolved_idx',
    );
    expect(health).toMatch(
      /where x\.result_observed_at is null and x\.pg_net_request_id is not null/,
    );
  });

  it('bounds runner history aggregates to the 24h diagnostic window and supports newest-run lookup', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(health).toMatch(
      /from cron\.job_run_details d where d\.jobid=runner_jobid and d\.start_time>=observed_at-interval '24 hours'/,
    );
    expect(migrationCorpus).toContain(
      'visionfood_onesignal_cron_history_job_start_idx',
    );
    expect(migrationCorpus).toMatch(
      /on cron\.job_run_details\s*\(jobid,start_time desc,runid desc\)/,
    );
  });

  it('adds selective health indexes for recent terminal/progress windows instead of forcing terminal-history scans', () => {
    expect(migrationCorpus).toContain('onesignal_outbox_health_failed_idx');
    expect(migrationCorpus).toContain('onesignal_outbox_health_delivered_idx');
    expect(migrationCorpus).toContain('onesignal_outbox_health_attempted_idx');
  });
});
