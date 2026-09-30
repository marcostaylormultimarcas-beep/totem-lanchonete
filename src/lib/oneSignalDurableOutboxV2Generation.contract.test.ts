import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const phase2 = readFileSync(
  'supabase/migrations/20260930095500_visionfood_v2_onesignal_config_generation_phase2.sql',
  'utf8',
).toLowerCase().replace(/\s+/g, ' ');

const predecessor = readFileSync(
  'supabase/migrations/20260929055500_visionfood_v2_onesignal_committed_request_liveness.sql',
  'utf8',
).toLowerCase();

describe('OneSignal Durable Outbox V2 immutable config generation contract', () => {
  it('keeps the predecessor migration replayable before phase 2 runs', () => {
    expect(predecessor).toContain(
      "set stats_fetch_consistency='none'\nas $$\ndeclare",
    );
  });

  it('links live settings to the exact app and Vault secret generation', () => {
    expect(phase2).toContain(
      'alter table private.onesignal_settings add column if not exists config_generation_id uuid',
    );
    expect(phase2).toContain(
      'unique (id,app_id,api_key_secret_id)',
    );
    expect(phase2).toContain(
      'foreign key ( config_generation_id, app_id, api_key_secret_id )',
    );
    expect(phase2).toContain(
      'references private.onesignal_config_generations( id, app_id, api_key_secret_id )',
    );
  });

  it('seeds the current valid settings pair without rewriting its Vault secret', () => {
    expect(phase2).toContain(
      'from vault.secrets vs where vs.id=current_secret_id',
    );
    expect(phase2).toContain(
      'insert into private.onesignal_config_generations( app_id, api_key_secret_id )',
    );
    expect(phase2).toContain(
      'set config_generation_id=seeded_generation_id',
    );
    expect(phase2).not.toContain('vault.update_secret');
  });

  it('makes each API-key rotation create a new secret and immutable generation', () => {
    expect(phase2).toContain('generation_id:=gen_random_uuid()');
    expect(phase2).toContain('sid:=vault.create_secret(');
    expect(phase2).toContain(
      "'onesignal_api_key::global::'||generation_id::text",
    );
    expect(phase2).toContain(
      'insert into private.onesignal_config_generations( id, app_id, api_key_secret_id )',
    );
    expect(phase2).toContain(
      'config_generation_id=excluded.config_generation_id',
    );
    expect(phase2).toContain(
      'create trigger trg_onesignal_config_generations_immutable before update on private.onesignal_config_generations',
    );
    expect(phase2).toContain(
      "raise exception 'onesignal_config_generation_immutable'",
    );
    expect(phase2).not.toContain('delete from vault.secrets');
  });

  it('preserves legacy rotation guards while producers still use the live queue', () => {
    expect(phase2).toContain('pg_try_advisory_xact_lock(config_guard)');
    expect(phase2).toContain('net.http_request_queue');
    expect(phase2).toContain('for update skip locked');
    expect(phase2).toContain('pg_catalog.pg_stat_activity');
    expect(phase2).toContain("set stats_fetch_consistency='none'");
    expect(phase2).not.toContain(
      'create or replace function public.visionfood_onesignal_queue',
    );
  });

  it('does not activate the durable outbox transport in phase 2', () => {
    expect(phase2).not.toContain('net.http_post');
    expect(phase2).not.toContain('insert into private.onesignal_outbox');
    expect(phase2).not.toContain('insert into private.onesignal_outbox_attempts');
  });
});
