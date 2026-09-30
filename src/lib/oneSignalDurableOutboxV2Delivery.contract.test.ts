import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const phase5Path =
  'supabase/migrations/20260930110500_visionfood_v2_onesignal_durable_outbox_delivery_phase5.sql';
const phase5 = readFileSync(phase5Path, 'utf8');

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

const deliverySql = latestPublicFunction('visionfood_push_delivery_trigger');
const ruptureSql = latestPublicFunction('visionfood_push_rupture_trigger');

describe('OneSignal Durable Outbox V2 phase 5 delivery cutover', () => {
  it('migrates only delivery and leaves rupture on the legacy queue', () => {
    expect(phase5).toContain(
      'create or replace function public.visionfood_push_delivery_trigger()',
    );
    expect(phase5).not.toContain('visionfood_push_rupture_trigger(');
    expect(phase5).not.toContain(
      'create or replace function public.visionfood_push_predictive_stock',
    );
    expect(phase5).not.toContain(
      'create or replace function public.visionfood_onesignal_queue',
    );
    expect(ruptureSql).toContain('public.visionfood_onesignal_queue(');
  });

  it('preserves the out_for_delivery trigger contract and phone normalization', () => {
    expect(deliverySql).toContain("new.status<>'out_for_delivery'");
    expect(deliverySql).toContain('old.status is not distinct from new.status');
    expect(deliverySql).toContain(
      "phone:=regexp_replace(coalesce(new.customer_phone,''),'\\D','','g')",
    );
    expect(deliverySql).toContain("left(phone,4)='0055'");
    expect(deliverySql).toContain("phone:='55'||phone");
    expect(deliverySql).toContain('if length(phone)<8 then');
    expect(deliverySql).toMatch(/return new;/i);
  });

  it('freezes the same customer audience and delivery payload in the outbox', () => {
    expect(deliverySql).toMatch(
      /visionfood_onesignal_outbox_enqueue\([\s\S]*new\.organization_id[\s\S]*'delivery'[\s\S]*'order_status'/i,
    );
    expect(deliverySql).toMatch(
      /'include_aliases'[\s\S]*'external_id'[\s\S]*jsonb_build_array\(phone\)/i,
    );
    expect(deliverySql).toContain("'pt','🚀 Seu pedido saiu!'");
    expect(deliverySql).toContain(
      "'pt','O motoboy iniciou a entrega e seu pedido está a caminho.'",
    );
    expect(deliverySql).toMatch(
      /'event','out_for_delivery'[\s\S]*'order_id',new\.id[\s\S]*'organization_id',new\.organization_id/i,
    );
  });

  it('keeps one immutable idempotency key for the durable logical request and its retries', () => {
    expect(deliverySql).toContain(
      'delivery_idempotency_key:=gen_random_uuid()',
    );
    expect(deliverySql).toMatch(
      /visionfood_onesignal_outbox_enqueue\([\s\S]*delivery_idempotency_key[\s\S]*\);/i,
    );
    expect(deliverySql).toMatch(
      /visionfood_onesignal_outbox_dispatch_one\([\s\S]*delivery_outbox_id[\s\S]*'delivery-trigger'/i,
    );
  });

  it('does not use legacy pg_net state as delivery source of truth', () => {
    expect(deliverySql).toContain('private.visionfood_onesignal_outbox_enqueue');
    expect(deliverySql).toContain(
      'private.visionfood_onesignal_outbox_dispatch_one',
    );
    expect(deliverySql).not.toContain('public.visionfood_onesignal_queue');
    expect(deliverySql).not.toContain('net._http_response');
    expect(deliverySql).not.toContain('net.http_request_queue');
    expect(deliverySql).not.toContain('net.http_post');
  });

  it('preserves fail-open behavior when OneSignal is not configured', () => {
    expect(deliverySql).toContain("sqlstate='55000'");
    expect(deliverySql).toContain(
      "sqlerrm='onesignal_outbox_not_configured'",
    );
    expect(deliverySql).toMatch(
      /onesignal_outbox_not_configured'[\s\S]*return new;/i,
    );
  });

  it('keeps the delivery trigger privilege surface unchanged', () => {
    expect(phase5).toMatch(
      /revoke all on function public\.visionfood_push_delivery_trigger\(\)[\s\S]*from public,anon,authenticated/i,
    );
  });
});
