import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const phase3 = readFileSync(
  'supabase/migrations/20260930101200_visionfood_v2_onesignal_durable_outbox_phase3.sql',
  'utf8',
).toLowerCase().replace(/\s+/g, ' ');

describe('OneSignal Durable Outbox V2 phase 3 runtime contract', () => {
  it('keeps all existing producers on the legacy path during phase 3', () => {
    expect(phase3).not.toContain(
      'create or replace function public.visionfood_onesignal_queue',
    );
    expect(phase3).not.toContain(
      'create or replace function public.visionfood_push_predictive_stock',
    );
    expect(phase3).not.toContain('visionfood_push_delivery_trigger(');
    expect(phase3).not.toContain('visionfood_push_rupture_trigger(');
    expect(phase3).not.toContain(
      'create or replace function public.set_onesignal_config',
    );
  });

  it('freezes the logical request and makes enqueue idempotent across config rotation', () => {
    expect(phase3).toContain(
      'create or replace function private.visionfood_guard_onesignal_outbox_frozen_update()',
    );
    expect(phase3).toContain(
      "raise exception 'onesignal_outbox_frozen_request_immutable'",
    );
    expect(phase3).toContain(
      'create or replace function private.visionfood_onesignal_outbox_enqueue(',
    );
    expect(phase3).toContain(
      'join private.onesignal_config_generations g on g.id=s.config_generation_id and g.app_id=s.app_id and g.api_key_secret_id=s.api_key_secret_id',
    );
    expect(phase3).toContain('on conflict (idempotency_key) do nothing');
    expect(phase3).toContain("'app_id',existing.app_id");
    expect(phase3).toContain(
      "raise exception 'onesignal_outbox_idempotency_conflict'",
    );
  });

  it('claims eligible rows concurrently with a durable lease and monotonic attempt number', () => {
    expect(phase3).toContain(
      'create or replace function private.visionfood_onesignal_outbox_claim(',
    );
    expect(phase3).toContain("where o.status in ('pending','retry')");
    expect(phase3).toContain('for update skip locked');
    expect(phase3).toContain('attempt_count=o.attempt_count+1');
    expect(phase3).toContain('lease_token=gen_random_uuid()');
    expect(phase3).toContain('lease_owner=worker_name');
    expect(phase3).toContain('lease_expires_at=pg_catalog.clock_timestamp()');
  });

  it('dispatches the exact frozen payload with the exact immutable generation secret', () => {
    expect(phase3).toContain(
      'create or replace function private.visionfood_onesignal_outbox_dispatch(',
    );
    expect(phase3).toContain(
      'from private.visionfood_onesignal_outbox_claim( _worker, _batch_limit, _lease_seconds )',
    );
    expect(phase3).toContain(
      'from private.onesignal_config_generations g join vault.decrypted_secrets ds on ds.id=g.api_key_secret_id',
    );
    expect(phase3).toContain('where g.id=c.claimed_generation_id');
    expect(phase3).toContain('and g.app_id=c.claimed_app_id');
    expect(phase3).toContain("url:='https://api.onesignal.com/notifications'");
    expect(phase3).toContain('body:=c.claimed_payload');
    expect(phase3).toContain(
      'insert into private.onesignal_outbox_attempts( outbox_id, attempt_no, lease_token, pg_net_request_id, created_at, submitted_at )',
    );
    expect(phase3).toContain(
      "raise exception 'onesignal_outbox_claim_lost_before_dispatch_persist'",
    );
  });

  it('keeps attempt identity immutable and allows its result to be written only once', () => {
    expect(phase3).toContain(
      'create or replace function private.visionfood_guard_onesignal_outbox_attempt_update()',
    );
    expect(phase3).toContain(
      "raise exception 'onesignal_outbox_attempt_identity_immutable'",
    );
    expect(phase3).toContain(
      "raise exception 'onesignal_outbox_attempt_result_immutable'",
    );
    expect(phase3).toContain('if old.result_observed_at is not null then');
    expect(phase3).toContain(
      'revoke insert,update,delete on table private.onesignal_outbox_attempts from service_role',
    );
  });

  it('uses pg_net only as transport and fails closed on unsafe request/response correlation', () => {
    expect(phase3).toContain(
      'create or replace function private.visionfood_onesignal_outbox_reconcile(',
    );
    expect(phase3).toContain('from net._http_response r');
    expect(phase3).not.toContain('net.http_request_queue');
    expect(phase3).not.toContain('pg_stat_activity');
    expect(phase3).not.toContain('backend_xid');
    expect(phase3).not.toContain('q.xmax');
    expect(phase3).toContain(
      'where x.pg_net_request_id=a.pg_net_request_id',
    );
    expect(phase3).toContain(
      'and r.created>=coalesce(a.submitted_at,a.created_at)',
    );
    expect(phase3).toContain("'transport_request_id_ambiguous'");
    expect(phase3).toContain("'transport_response_ambiguous'");
  });

  it('accepts only semantic OneSignal success and makes delivered monotonic', () => {
    expect(phase3).toContain('response_status>=200');
    expect(phase3).toContain('and response_status<300');
    expect(phase3).toContain('not coalesce(response_timed_out,false)');
    expect(phase3).toContain(
      "nullif(btrim(coalesce(response_error,'')),'') is null",
    );
    expect(phase3).toContain("response_payload->>'id'");
    expect(phase3).toContain("semantic_outcome='delivered'");
    expect(phase3).toContain("set status='delivered'");
    expect(phase3).toContain("and outbox.status<>'delivered'");
    expect(phase3).toContain('failed_at=null');
  });

  it('retries the same frozen logical row and leaves missing responses observable for late success', () => {
    expect(phase3).toContain(
      'create or replace function private.visionfood_onesignal_outbox_retry(',
    );
    expect(phase3).toContain("when o.attempt_count>=max_attempts then 'failed'");
    expect(phase3).toContain("else 'retry'");
    expect(phase3).toContain("'response_missing'");
    expect(phase3).toContain(
      'keep attempt.result_observed_at null. a late onesignal success from this',
    );
    expect(phase3).toContain(
      'if not found or o.attempt_count<>a.attempt_no then',
    );
    expect(phase3).toContain("'stale_failure'");
  });
});
