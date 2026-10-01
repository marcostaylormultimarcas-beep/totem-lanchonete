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

const phase11 = normalize(
  readFileSync(
    join(
      migrationsDir,
      '20261001153000_visionfood_v2_onesignal_durable_outbox_fairness_phase11.sql',
    ),
    'utf8',
  ),
);

const migrationCorpus = normalize(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .join('\n'),
);

describe('OneSignal Durable Outbox V2 phase 12 fairness execution cost', () => {
  it('proves phase11 materializes/ranks the whole eligible backlog before the bounded batch', () => {
    expect(phase11).toContain('with ranked as materialized');
    expect(phase11).toContain('with prioritized as materialized');
    expect(phase11).toContain('), ranked as materialized');
  });

  it('requires claim fairness to enumerate organizations and fetch only a bounded per-org prefix', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).not.toBe('');
    expect(claim).not.toContain('ranked as materialized');
    expect(claim).toContain('with recursive active_organizations');
    expect(claim).toContain('cross join lateral');
    expect(claim).toContain('per_organization_candidates');
    expect(claim).toMatch(
      /order by o\.available_at,o\.created_at,o\.id\s+limit least\(/,
    );
    expect(claim).toContain('partition by p.organization_id');
    expect(claim).toContain('organization_rank');
    expect(claim).toMatch(/for update(?: of o)? skip locked/);
    expect(claim).toContain('limit batch_size');
  });

  it('requires reconcile to rank only actionable responses or expired current leases', () => {
    const reconcile = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_reconcile',
    );

    expect(reconcile).not.toBe('');
    expect(reconcile).not.toContain('prioritized as materialized');
    expect(reconcile).not.toContain('ranked as materialized');
    expect(reconcile).toContain('actionable_raw as');
    expect(reconcile).toMatch(
      /from net\._http_response r\s+join private\.onesignal_outbox_attempts x/,
    );
    expect(reconcile).toContain("current_o.status='sending'");
    expect(reconcile).toContain(
      'current_o.lease_expires_at<=pg_catalog.clock_timestamp()',
    );
    expect(reconcile).toContain('group by raw.id');
    expect(reconcile).toContain('partition by prioritized.organization_id');
    expect(reconcile).toContain('ranked.organization_rank<=batch_size');
    expect(reconcile).toMatch(/for update of x skip locked/);
  });

  it('adds an unresolved request-id index for response-driven reconciliation', () => {
    expect(migrationCorpus).toContain(
      'onesignal_outbox_attempts_unresolved_request_idx',
    );
    expect(migrationCorpus).toMatch(
      /on private\.onesignal_outbox_attempts\s*\(pg_net_request_id,id\)\s*where result_observed_at is null\s*and pg_net_request_id is not null/,
    );
  });
});
