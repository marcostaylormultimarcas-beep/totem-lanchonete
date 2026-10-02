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

const phase12 = normalize(
  readFileSync(
    join(
      migrationsDir,
      '20261001154500_visionfood_v2_onesignal_durable_outbox_fairness_plan_phase12.sql',
    ),
    'utf8',
  ),
);

describe('OneSignal Durable Outbox V2 phase 13 bounded-claim concurrency/liveness', () => {
  it('proves phase12 can systematically underfill a concurrent worker after SKIP LOCKED exhausts the per-org prefix', () => {
    const batchSize = 100;
    const organizationCount = 50;
    const perOrganizationPrefix = Math.ceil(batchSize / organizationCount);

    const backlog = Array.from({ length: organizationCount }, (_, org) =>
      Array.from({ length: 20 }, (_, row) => ({ org, row })),
    ).flat();

    const phase12Candidates = backlog.filter(
      ({ row }) => row < perOrganizationPrefix,
    );

    expect(phase12Candidates).toHaveLength(batchSize);

    const workerOneLocks = new Set(
      phase12Candidates.map(({ org, row }) => `${org}:${row}`),
    );

    const workerTwoClaimableFromSamePrefix = phase12Candidates.filter(
      ({ org, row }) => !workerOneLocks.has(`${org}:${row}`),
    );

    const unlockedBacklogBeyondPrefix = backlog.filter(
      ({ row }) => row >= perOrganizationPrefix,
    );

    expect(workerTwoClaimableFromSamePrefix).toHaveLength(0);
    expect(unlockedBacklogBeyondPrefix.length).toBeGreaterThan(batchSize);
  });

  it('proves phase12 organization enumeration is unbounded by batch size', () => {
    expect(phase12).toContain('with recursive active_organizations');
    expect(phase12).toContain(
      'select pg_catalog.count(*)::integer as organization_count from active_organizations',
    );
    expect(phase12).not.toContain('current_org.organization_ordinal<batch_size');
    expect(phase12).not.toContain('forward_org.organization_ordinal<batch_size');
  });

  it('proves phase12 can starve organizations beyond the batch across repeated ticks', () => {
    const batchSize = 100;
    const oldOrganizations = Array.from({ length: batchSize }, (_, org) => ({
      org,
      due: Array.from({ length: 20 }, (_, row) => row),
    }));
    const laterOrganizations = Array.from({ length: 50 }, (_, index) => ({
      org: batchSize + index,
      due: [10_000 + index],
    }));
    const organizations = [...oldOrganizations, ...laterOrganizations];

    const served = new Set<number>();

    for (let tick = 0; tick < 5; tick += 1) {
      const rankOne = organizations
        .filter((organization) => organization.due.length > 0)
        .map((organization) => ({
          org: organization.org,
          due: organization.due[0],
        }))
        .sort((a, b) => a.due - b.due || a.org - b.org)
        .slice(0, batchSize);

      for (const selected of rankOne) {
        served.add(selected.org);
        const organization = organizations.find(
          (candidate) => candidate.org === selected.org,
        );
        organization?.due.shift();
      }
    }

    expect([...served].every((org) => org < batchSize)).toBe(true);
    expect(
      laterOrganizations.some((organization) => served.has(organization.org)),
    ).toBe(false);
  });

  it('requires the bounded rotating organization window and deep contention prefix to survive later hardening', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(claim).not.toBe('');
    expect(claim).toContain('onesignal_outbox_claim_fairness_state');
    expect(claim).toContain('last_organization_id');
    expect(claim).toContain('organization_ordinal');
    expect(claim).toMatch(/organization_ordinal\s*<\s*batch_size/);
    expect(claim).toMatch(
      /order by o\.available_at,o\.created_at,o\.id\s+limit batch_size/,
    );
    expect(claim).toMatch(/for update of o skip locked/);
    expect(claim).toContain('advance_target');
    expect(claim).toContain('fairness_progress');
  });
});
