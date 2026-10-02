import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260930093000_visionfood_v2_onesignal_durable_outbox_base.sql',
  'utf8',
).toLowerCase().replace(/\s+/g, ' ');

describe('OneSignal Durable Outbox V2 base contract', () => {
  it('keeps the first step additive and disconnected from the live transport path', () => {
    expect(migration).not.toContain('create or replace function public.visionfood_onesignal_queue');
    expect(migration).not.toContain('create or replace function public.set_onesignal_config');
    expect(migration).not.toContain('net.http_post');
    expect(migration).not.toContain('net.http_request_queue');
    expect(migration).not.toContain('pg_stat_activity');
  });

  it('stores an immutable configuration generation separate from the transport attempt', () => {
    expect(migration).toContain('create table if not exists private.onesignal_config_generations');
    expect(migration).toContain('api_key_secret_id uuid not null');
    expect(migration).toContain('unique (id,app_id)');
    expect(migration).toContain('foreign key (config_generation_id,app_id)');
    expect(migration).toContain('references private.onesignal_config_generations(id,app_id)');
  });

  it('freezes tenant, origin, audience, payload, app and idempotency identity on the outbox row', () => {
    expect(migration).toContain('organization_id uuid not null');
    expect(migration).toContain('push_type text not null');
    expect(migration).toContain('source_kind text not null');
    expect(migration).toContain('source_key text not null');
    expect(migration).toContain('audience jsonb not null');
    expect(migration).toContain('payload jsonb not null');
    expect(migration).toContain('idempotency_key uuid not null');
    expect(migration).toContain("payload->>'app_id'=app_id");
    expect(migration).toContain("payload->>'idempotency_key'=idempotency_key::text");
    expect(migration).toContain("payload #>> '{data,organization_id}'=organization_id::text");
    expect(migration).toContain('payload @> audience');
    expect(migration).toContain('onesignal_outbox_idempotency_key_uidx');
  });

  it('defines the durable state and lease fields needed for safe concurrent claiming', () => {
    expect(migration).toContain("status in ('pending','sending','delivered','retry','failed')");
    expect(migration).toContain('attempt_count integer not null default 0');
    expect(migration).toContain('available_at timestamptz not null default now()');
    expect(migration).toContain('lease_token uuid');
    expect(migration).toContain('lease_owner text');
    expect(migration).toContain('lease_expires_at timestamptz');
    expect(migration).toContain('onesignal_outbox_claim_idx');
    expect(migration).toContain('onesignal_outbox_expired_lease_idx');
  });

  it('keeps every pg_net request id attached to its immutable attempt', () => {
    expect(migration).toContain('create table if not exists private.onesignal_outbox_attempts');
    expect(migration).toContain('attempt_no integer not null');
    expect(migration).toContain('pg_net_request_id bigint');
    expect(migration).toContain('unique (outbox_id,attempt_no)');
    expect(migration).toContain('onesignal_outbox_attempts_request_idx');
    expect(migration).not.toContain('onesignal_outbox_attempts_request_uidx');
    expect(migration).toContain("semantic_outcome in ('delivered','retry','failed')");
  });

  it('keeps durable OneSignal internals private from browser roles', () => {
    expect(migration).toMatch(
      /revoke all on table private\.onesignal_config_generations from public,anon,authenticated/,
    );
    expect(migration).toMatch(
      /revoke all on table private\.onesignal_outbox from public,anon,authenticated/,
    );
    expect(migration).toMatch(
      /revoke all on table private\.onesignal_outbox_attempts from public,anon,authenticated/,
    );
  });
});
