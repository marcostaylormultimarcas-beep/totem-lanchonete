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

const phase3 = normalize(
  readFileSync(
    join(
      migrationsDir,
      '20260930101200_visionfood_v2_onesignal_durable_outbox_phase3.sql',
    ),
    'utf8',
  ),
);

describe('OneSignal Durable Outbox V2 phase 11 organization fairness', () => {
  it('proves the pre-phase11 global FIFO batch can be monopolized by one organization', () => {
    const claimStart = phase3.indexOf(
      'create or replace function private.visionfood_onesignal_outbox_claim(',
    );
    const retryStart = phase3.indexOf(
      'create or replace function private.visionfood_onesignal_outbox_retry(',
    );
    const claim = phase3.slice(claimStart, retryStart);

    expect(claim).toContain(
      'order by o.available_at,o.created_at,o.id for update skip locked limit batch_size',
    );
    expect(claim).not.toContain('partition by o.organization_id');

    const heavy = Array.from({ length: 500 }, (_, index) => ({
      organization: 'heavy',
      dueOrder: index,
    }));
    const small = [{ organization: 'small', dueOrder: 500 }];

    const firstBatch = [...heavy, ...small]
      .sort((a, b) => a.dueOrder - b.dueOrder)
      .slice(0, 100);

    expect(new Set(firstBatch.map((row) => row.organization))).toEqual(
      new Set(['heavy']),
    );
  });

  it('requires claim to interleave organizations while preserving FIFO inside each organization', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).not.toBe('');
    expect(claim).toContain('row_number() over');
    expect(claim).toContain('partition by o.organization_id');
    expect(claim).toContain(
      'order by o.available_at,o.created_at,o.id',
    );
    expect(claim).toContain('organization_rank');
    expect(claim).toContain(
      'order by r.organization_rank,r.available_at,r.created_at,r.id',
    );
    expect(claim).toMatch(/for update(?: of o)? skip locked/);
    expect(claim).toContain('limit batch_size');
  });

  it('requires reconcile to interleave organizations without dropping phase10 response/lease priority', () => {
    const reconcile = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_reconcile',
    );

    expect(reconcile).not.toBe('');
    expect(reconcile).toContain('row_number() over');
    expect(reconcile).toContain('partition by prioritized.organization_id');
    expect(reconcile).toContain('response_priority');
    expect(reconcile).toContain('lease_priority');
    expect(reconcile).toContain(
      'order by prioritized.response_priority,prioritized.lease_priority,prioritized.submitted_at,prioritized.id',
    );
    expect(reconcile).toContain('organization_rank');
    expect(reconcile).toContain(
      'order by ranked.organization_rank,ranked.response_priority,ranked.lease_priority,ranked.submitted_at,ranked.id',
    );
    expect(reconcile).toMatch(/for update of x skip locked/);
  });

  it('keeps the immutable logical request contract untouched by fairness scheduling', () => {
    expect(phase3).toContain(
      'new.organization_id is distinct from old.organization_id',
    );
    expect(phase3).toContain(
      'new.config_generation_id is distinct from old.config_generation_id',
    );
    expect(phase3).toContain('new.app_id is distinct from old.app_id');
    expect(phase3).toContain('new.audience is distinct from old.audience');
    expect(phase3).toContain('new.payload is distinct from old.payload');
    expect(phase3).toContain(
      'new.idempotency_key is distinct from old.idempotency_key',
    );
  });
});
