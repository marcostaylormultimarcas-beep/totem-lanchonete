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

describe('OneSignal Durable Outbox V2 phase 20 transaction-abort observability', () => {
  it('separates 40001 and 40P01 aborts from generic cron failures in short and long windows', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(health).not.toBe('');
    expect(health).toContain('cron.job_run_details');
    expect(health).toContain('return_message');
    expect(health).toContain('could not serialize access');
    expect(health).toContain('deadlock detected');
    expect(health).toContain("'serialization_aborts_5m'");
    expect(health).toContain("'deadlock_aborts_5m'");
    expect(health).toContain("'transaction_aborts_24h'");
  });

  it('exposes a bounded abort-rate denominator and consecutive abort streak', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(health).toContain("'runs_5m'");
    expect(health).toContain("'transaction_abort_rate_5m'");
    expect(health).toContain("'consecutive_transaction_aborts'");
  });

  it('measures committed runner progress separately from producer enqueue activity', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(health).toContain('attempt_count>0');
    expect(health).toContain("'last_progress_at'");
    expect(health).toContain("'progress_lag_seconds'");
    expect(health).toContain("'progress_stalled'");
  });

  it('exposes a conservative recent backlog-growth signal instead of treating a burst as persistent degradation by itself', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(health).toContain("'created_5m'");
    expect(health).toContain("'terminal_5m'");
    expect(health).toContain("'net_growth_5m'");
    expect(health).toContain("'backlog_growing'");
  });

  it('requires abort pressure plus stalled progress and growing backlog before declaring persistent degradation', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(health).toContain("'transaction_abort_state'");
    expect(health).toContain("'degraded'");
    expect(health).toContain("'transient'");
    expect(health).toContain('progress_stalled');
    expect(health).toContain('backlog_growing');
    expect(health).toContain('transaction_abort_rate_5m');
  });
});
