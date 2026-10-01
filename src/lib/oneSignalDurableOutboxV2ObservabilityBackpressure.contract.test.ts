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

describe('OneSignal Durable Outbox V2 phase 10 observability/backpressure', () => {
  it('exposes backlog, stalled sending, failed growth, attempts growth and cron health', () => {
    const health = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_health',
    );

    expect(health).not.toBe('');
    expect(health).toContain("'pending_due'");
    expect(health).toContain("'retry_due'");
    expect(health).toContain("'sending'");
    expect(health).toContain("'expired_sending'");
    expect(health).toContain("'failed_24h'");
    expect(health).toContain("'attempts_24h'");
    expect(health).toContain("'unresolved_attempts'");
    expect(health).toContain('cron.job_run_details');
    expect(health).toContain("'runner_delayed'");
    expect(health).toContain("'cleanup_delayed'");
  });

  it('does not let old late-response attempts monopolize every reconcile batch', () => {
    const reconcile = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_reconcile',
    );
    const selection = reconcile.slice(0, reconcile.indexOf(' loop '));

    expect(selection).toContain('response_priority');
    expect(selection).toContain('net._http_response');
    expect(selection).toContain('lease_priority');
    expect(selection).toContain('for update skip locked');
  });

  it('drains multiple bounded batches per runner tick without creating an unbounded cron transaction', () => {
    const runner = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_run_once',
    );

    expect(runner).toContain('_max_rounds integer default');
    expect(runner).toContain('greatest(1,least(coalesce(_max_rounds');
    expect(runner).toContain('dispatch_rounds');
    expect(runner).toContain('exit when');
    expect(runner).toContain('rounds>=max_rounds');
  });

  it('bounds pg_cron observability history instead of letting 15-second runner history grow forever', () => {
    const cleanup = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_cleanup',
    );

    expect(cleanup).toContain('cron.job_run_details');
    expect(cleanup).toContain("interval '7 days'");
    expect(cleanup).toContain("'visionfood-onesignal-outbox-v2'");
    expect(cleanup).toContain("'visionfood-onesignal-outbox-v2-cleanup'");
  });
});
