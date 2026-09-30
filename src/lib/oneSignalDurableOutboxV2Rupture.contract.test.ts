import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const phase6Path =
  'supabase/migrations/20260930112500_visionfood_v2_onesignal_durable_outbox_rupture_phase6.sql';
const phase6 = readFileSync(phase6Path, 'utf8');

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

const ruptureSql = latestPublicFunction('visionfood_push_rupture_trigger');
const deliverySql = latestPublicFunction('visionfood_push_delivery_trigger');
const predictiveSql = latestPublicFunction('visionfood_push_predictive_stock');

describe('OneSignal Durable Outbox V2 phase 6 rupture cutover', () => {
  it('migrates only rupture and leaves the already-migrated producers untouched', () => {
    expect(phase6).toContain(
      'create or replace function public.visionfood_push_rupture_trigger()',
    );
    expect(phase6).not.toContain('visionfood_push_delivery_trigger(');
    expect(phase6).not.toContain(
      'create or replace function public.visionfood_push_predictive_stock',
    );
    expect(phase6).not.toContain(
      'create or replace function public.visionfood_onesignal_queue',
    );
    expect(phase6).not.toContain(
      'create or replace function public.set_onesignal_config',
    );
  });

  it('preserves the positive-to-zero rupture trigger contract without replacing the trigger itself', () => {
    expect(ruptureSql).toContain(
      'if coalesce(old.estoque_atual,0)<=0',
    );
    expect(ruptureSql).toContain(
      'or coalesce(new.estoque_atual,0)>0 then',
    );
    expect(ruptureSql).toMatch(/return new;/i);
    expect(phase6).not.toContain('drop trigger');
    expect(phase6).not.toContain('create trigger');
  });

  it('freezes the same organization-scoped admin audience and rupture payload', () => {
    expect(ruptureSql).toMatch(
      /visionfood_onesignal_outbox_enqueue\([\s\S]*new\.organization_id[\s\S]*'stock_rupture'[\s\S]*'ingredient_stock'/i,
    );
    expect(ruptureSql).toMatch(
      /'filters'[\s\S]*'tipo'[\s\S]*'admin'[\s\S]*'organization_id'[\s\S]*new\.organization_id::text/i,
    );
    expect(ruptureSql).toContain("'pt','🚨 Ruptura de Estoque'");
    expect(ruptureSql).toContain(
      `'pt','O ingrediente "'||left(coalesce(new.nome,'Ingrediente'),120)||'" zerou. Verifique o estoque no painel.'`,
    );
    expect(ruptureSql).toMatch(
      /'event','stock_rupture'[\s\S]*'ingredient_id',new\.id[\s\S]*'organization_id',new\.organization_id/i,
    );
  });

  it('keeps one immutable idempotency key for the rupture request and all retries', () => {
    expect(ruptureSql).toContain(
      'rupture_idempotency_key:=gen_random_uuid()',
    );
    expect(ruptureSql).toMatch(
      /visionfood_onesignal_outbox_enqueue\([\s\S]*rupture_idempotency_key[\s\S]*\);/i,
    );
    expect(ruptureSql).toMatch(
      /visionfood_onesignal_outbox_dispatch_one\([\s\S]*rupture_outbox_id[\s\S]*'rupture-trigger'/i,
    );
  });

  it('eliminates the final legacy producer and keeps pg_net as transport only', () => {
    for (const sql of [ruptureSql, deliverySql, predictiveSql]) {
      expect(sql).toContain('private.visionfood_onesignal_outbox');
      expect(sql).not.toContain('public.visionfood_onesignal_queue');
      expect(sql).not.toContain('net._http_response');
      expect(sql).not.toContain('net.http_request_queue');
      expect(sql).not.toContain('net.http_post');
    }
  });

  it('preserves fail-open behavior when OneSignal is not configured', () => {
    expect(ruptureSql).toContain("sqlstate='55000'");
    expect(ruptureSql).toContain(
      "sqlerrm='onesignal_outbox_not_configured'",
    );
    expect(ruptureSql).toMatch(
      /onesignal_outbox_not_configured'[\s\S]*return new;/i,
    );
  });

  it('keeps the rupture trigger privilege surface unchanged', () => {
    expect(phase6).toMatch(
      /revoke all on function public\.visionfood_push_rupture_trigger\(\)[\s\S]*from public,anon,authenticated/i,
    );
  });
});
