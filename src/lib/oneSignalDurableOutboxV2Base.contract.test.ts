import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260930124000_visionfood_v2_onesignal_durable_outbox_v2_base.sql',
  'utf8',
);

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
const sql = normalize(migration);

describe('OneSignal Durable Outbox V2 base contract', () => {
  it('creates a durable organization-scoped logical request with frozen routing inputs', () => {
    expect(sql).toContain('create table if not exists private.onesignal_push_outbox');
    expect(sql).toContain('organization_id uuid not null');
    expect(sql).toContain('origin text not null');
    expect(sql).toContain('app_id text not null');
    expect(sql).toContain('config_generation bigint not null');
    expect(sql).toContain('audience jsonb not null');
    expect(sql).toContain('payload jsonb not null');
    expect(sql).toContain('idempotency_key uuid not null');
    expect(sql).toContain('unique (idempotency_key)');
  });

  it('models explicit durable states, retry scheduling and a recoverable sending lease', () => {
    for (const state of ['pending', 'sending', 'delivered', 'retry', 'failed']) {
      expect(sql).toContain(`'${state}'`);
    }

    expect(sql).toContain('attempts integer not null default 0');
    expect(sql).toContain('next_attempt_at timestamptz not null default now()');
    expect(sql).toContain('lease_token uuid');
    expect(sql).toContain('lease_expires_at timestamptz');
    expect(sql).toContain("where status in ('pending','retry')");
    expect(sql).toContain("where status='sending'");
  });

  it('keeps every pg_net attempt so late responses can be correlated without replacing outbox identity', () => {
    expect(sql).toContain(
      'create table if not exists private.onesignal_push_outbox_attempts',
    );
    expect(sql).toContain('primary key (outbox_id,attempt_no)');
    expect(sql).toContain('request_id bigint');
    expect(sql).toContain('result_observed_at timestamptz');
    expect(sql).toContain('http_status integer');
    expect(sql).toContain('timed_out boolean');
    expect(sql).toContain('response_body text');
    expect(sql).toContain('onesignal_notification_id text');

    expect(sql).toContain(
      'create index if not exists onesignal_push_outbox_attempt_request_idx',
    );
    expect(sql).not.toMatch(/unique\s*\(\s*request_id\s*\)/i);
  });

  it('keeps transport/result details on the outbox without trusting pg_net as source of truth', () => {
    expect(sql).toContain('request_id bigint');
    expect(sql).toContain('last_http_status integer');
    expect(sql).toContain('last_error text');
    expect(sql).toContain('last_response_body text');
    expect(sql).toContain('onesignal_notification_id text');
    expect(sql).toContain(
      "where status in ('pending','sending','retry')",
    );
  });

  it('is behavior-neutral in the foundation migration', () => {
    expect(sql).not.toContain('create or replace function');
    expect(sql).not.toContain('net.http_post');
    expect(sql).not.toContain('net.http_request_queue');
    expect(sql).not.toContain('pg_stat_activity');
    expect(sql).not.toContain('backend_xid');
    expect(sql).not.toContain('q.xmax');
  });
});
