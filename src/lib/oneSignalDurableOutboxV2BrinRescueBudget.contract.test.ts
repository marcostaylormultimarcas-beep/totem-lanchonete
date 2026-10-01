import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync('supabase/migrations/20261001150000_visionfood_v2_onesignal_durable_outbox_observability_backpressure_phase10.sql', 'utf8');
const cleanup = sql.slice(sql.indexOf('create or replace function private.visionfood_onesignal_outbox_cleanup('), sql.indexOf('create or replace function private.visionfood_onesignal_outbox_health('));
describe('phase 27 bounded BRIN rescue', () => {
  it('does not drain an arbitrarily large BRIN backlog in the retention transaction', () => {
    expect(cleanup).not.toMatch(/select\s+pg_catalog\.brin_summarize_new_values\(/);
    expect(cleanup).toContain('brin_summarize_range(');
    expect(cleanup).toContain('rescue_visits<1024');
    expect(cleanup).toContain("interval '250 milliseconds'");
  });
  it('persists progress, including visits to already summarized ranges', () => {
    expect(sql).toContain('create table if not exists private.onesignal_brin_rescue_cursor');
    expect(cleanup).toContain('next_page=rescue_page');
    expect(cleanup).toContain('rescue_page:=rescue_page+rescue_ppr');
    expect(cleanup).toContain('rescue_visits:=rescue_visits+1');
  });
  it('keeps serialization and bounds maintenance lock waits without erasing retention', () => {
    expect(cleanup).toContain('pg_try_advisory_xact_lock(cleanup_lock)');
    expect(cleanup).toContain('when lock_not_available then');
    expect(cleanup).toContain("set_config('lock_timeout',saved_lock_timeout,true)");
    expect(sql).toContain('revoke all on private.onesignal_brin_rescue_cursor');
  });
});
