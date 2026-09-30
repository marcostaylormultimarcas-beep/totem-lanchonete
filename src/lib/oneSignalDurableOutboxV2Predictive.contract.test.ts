import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const phase4Path =
  'supabase/migrations/20260930104500_visionfood_v2_onesignal_durable_outbox_predictive_phase4.sql';
const phase4 = readFileSync(phase4Path, 'utf8');

function latestPublicFunction(name: string): string {
  const needle = `create or replace function public.${name}(`;
  let latest: string | null = null;

  for (const file of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const lower = sql.toLowerCase();
    const start = lower.lastIndexOf(needle.toLowerCase());
    if (start < 0) continue;
    const next = lower.indexOf(
      '\ncreate or replace function public.',
      start + needle.length,
    );
    latest = sql.slice(start, next >= 0 ? next : sql.length);
  }

  if (!latest) throw new Error(`Function ${name} was not found`);
  return latest;
}

const enqueueSql = latestPublicFunction('visionfood_push_predictive_stock');
const resultSql = latestPublicFunction('visionfood_predictive_push_result');

describe('OneSignal Durable Outbox V2 phase 4 predictive cutover', () => {
  it('migrates only predictive and leaves delivery/rupture plus the legacy queue untouched', () => {
    expect(phase4).toContain(
      'create or replace function public.visionfood_push_predictive_stock(',
    );
    expect(phase4).toContain(
      'create or replace function public.visionfood_predictive_push_result(',
    );
    expect(phase4).not.toContain(
      'create or replace function public.visionfood_onesignal_queue',
    );
    expect(phase4).not.toContain('visionfood_push_delivery_trigger(');
    expect(phase4).not.toContain('visionfood_push_rupture_trigger(');
    expect(phase4).not.toContain(
      'create or replace function public.set_onesignal_config',
    );
  });

  it('keeps the public bigint request_id contract while mapping it to durable outbox UUID state', () => {
    expect(phase4).toMatch(
      /add column if not exists outbox_id uuid/i,
    );
    expect(phase4).toContain(
      'create sequence if not exists private.onesignal_predictive_request_id_seq',
    );
    expect(enqueueSql).toMatch(/public_request_id\s+bigint/i);
    expect(enqueueSql).toMatch(
      /request_id[\s\S]*outbox_id[\s\S]*predictive_outbox_id/i,
    );
    expect(resultSql).toContain('_request_id bigint');
    expect(resultSql).toMatch(
      /d\.request_id=_request_id[\s\S]*d\.outbox_id/i,
    );
  });

  it('freezes the exact organization-scoped subscription audience in the outbox', () => {
    expect(enqueueSql).toContain(
      'subscription_ids:=private.visionfood_admin_push_subscription_ids(_org)',
    );
    expect(enqueueSql).toMatch(
      /visionfood_onesignal_outbox_enqueue\([\s\S]*'include_subscription_ids'[\s\S]*subscription_ids/i,
    );
    expect(enqueueSql).not.toMatch(/included_segments|include_aliases|filters/i);
  });

  it('uses the durable outbox as predictive source of truth', () => {
    for (const sql of [enqueueSql, resultSql]) {
      expect(sql).toContain('private.onesignal_outbox');
      expect(sql).not.toContain('net._http_response');
      expect(sql).not.toContain('net.http_request_queue');
      expect(sql).not.toContain('public.visionfood_onesignal_queue');
    }
    expect(resultSql).toContain(
      'private.visionfood_onesignal_outbox_reconcile(500,15,8)',
    );
    expect(resultSql).toMatch(
      /outbox_status='delivered'[\s\S]*'delivered',true/i,
    );
    expect(resultSql).toMatch(
      /outbox_status='failed'[\s\S]*'failed',true/i,
    );
  });

  it('dispatches a predictive row by its exact outbox id instead of backlog ordering', () => {
    expect(phase4).toContain(
      'create or replace function private.visionfood_onesignal_outbox_dispatch_one(',
    );
    expect(phase4).toMatch(
      /where o\.id=_outbox_id[\s\S]*o\.status in \('pending','retry'\)[\s\S]*for update skip locked/i,
    );
    expect(phase4).toContain('body:=claimed_payload');
    expect(phase4).toContain('where g.id=claimed_generation_id');
    expect(phase4).toContain('and g.app_id=claimed_app_id');
  });

  it('preserves retry identity through the same immutable outbox row', () => {
    expect(enqueueSql).toMatch(
      /outbox_status in \('pending','retry'\)[\s\S]*visionfood_onesignal_outbox_dispatch_one\([\s\S]*previous_outbox_id/i,
    );
    expect(enqueueSql).toMatch(
      /idempotency_key[\s\S]*predictive_idempotency_key[\s\S]*outbox_id[\s\S]*predictive_outbox_id/i,
    );
    expect(enqueueSql).not.toMatch(
      /previous_idempotency_key\s*:=|predictive_idempotency_key\s*:=\s*previous/i,
    );
  });

  it('keeps delivered cooldown and legacy cutover fail-closed without transport inference', () => {
    expect(enqueueSql).toMatch(
      /outbox_status='delivered'[\s\S]*interval '24 hours'[\s\S]*'deduplicated',true/i,
    );
    expect(enqueueSql).toContain('legacy_request_cooldown');
    expect(resultSql).toContain('legacy_request_expired');
  });

  it('keeps tenant authorization and public execute grants unchanged', () => {
    for (const sql of [enqueueSql, resultSql]) {
      expect(sql).toContain('public.usuario_dono_org(_org,u)');
    }
    expect(phase4).toMatch(
      /revoke all on function public\.visionfood_push_predictive_stock\(uuid,text,integer\)[\s\S]*from public,anon/i,
    );
    expect(phase4).toMatch(
      /revoke all on function public\.visionfood_predictive_push_result\(uuid,bigint\)[\s\S]*from public,anon/i,
    );
  });
});
