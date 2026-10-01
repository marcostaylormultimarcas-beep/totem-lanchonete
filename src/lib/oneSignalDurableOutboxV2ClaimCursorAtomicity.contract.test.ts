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

const phase13 = normalize(
  readFileSync(
    join(
      migrationsDir,
      '20261001160000_visionfood_v2_onesignal_durable_outbox_claim_liveness_phase13.sql',
    ),
    'utf8',
  ),
);

const phase14 = normalize(
  readFileSync(
    join(
      migrationsDir,
      '20261001161500_visionfood_v2_onesignal_durable_outbox_claim_cursor_atomicity_phase14.sql',
    ),
    'utf8',
  ),
);

describe('OneSignal Durable Outbox V2 phase 14 claim cursor atomicity/liveness', () => {
  it('proves phase13 can advance the durable cursor from the visited window even when no row is effectively claimed', () => {
    expect(phase13).toContain(
      'advance_fairness_cursor as ( update private.onesignal_outbox_claim_fairness_state',
    );
    expect(phase13).toMatch(
      /select active_org\.organization_id from active_organizations active_org order by active_org\.organization_ordinal desc limit 1/,
    );
    expect(phase13).not.toMatch(
      /advance_fairness_cursor[\s\S]*from claimed/,
    );

    const previousCursor = 'org-000';
    const visitedOrganizations = ['org-001', 'org-002'];
    const claimedOrganizations: string[] = [];

    const phase13Cursor = visitedOrganizations.at(-1) ?? previousCursor;

    expect(claimedOrganizations).toHaveLength(0);
    expect(phase13Cursor).toBe('org-002');
    expect(phase13Cursor).not.toBe(previousCursor);
  });

  it('proves a skipped organization can wait until wrap-around after its lock holder rolls back', () => {
    const organizations = [1, 2, 3, 4, 5, 6];
    const batchSize = 2;
    let cursor = 0;

    const firstWindow = organizations
      .filter((org) => org > cursor)
      .slice(0, batchSize);

    expect(firstWindow).toEqual([1, 2]);

    // org 1 is SKIP LOCKED by another transaction. That transaction later
    // rolls back, so org 1 had no effective claim.
    const effectivelyClaimed = [2];
    expect(effectivelyClaimed).toEqual([2]);

    cursor = firstWindow.at(-1) ?? cursor;

    const secondWindow = organizations
      .filter((org) => org > cursor)
      .slice(0, batchSize);
    cursor = secondWindow.at(-1) ?? cursor;

    const thirdWindow = organizations
      .filter((org) => org > cursor)
      .slice(0, batchSize);

    expect(secondWindow).toEqual([3, 4]);
    expect(thirdWindow).toEqual([5, 6]);
    expect(secondWindow).not.toContain(1);
    expect(thirdWindow).not.toContain(1);
  });

  it('proves the phase13 random UUID fallback is biased by UUID keyspace gaps while the singleton row is locked', () => {
    expect(phase13).toContain('fallback_cursor:=gen_random_uuid()');
    expect(phase13).toMatch(/for update of s skip locked/);

    // Numeric analogue of UUID ordering. With batch=1, selecting the next key
    // after a uniform random cursor gives probability proportional to the
    // preceding keyspace gap instead of equal probability per organization.
    const organizations = [1, 2, 1000];
    const keyspaceMax = 1023;
    const counts = new Map<number, number>(
      organizations.map((organization) => [organization, 0]),
    );

    for (let fallbackCursor = 0; fallbackCursor <= keyspaceMax; fallbackCursor += 1) {
      const forward = organizations.find((org) => org > fallbackCursor);
      const selected = forward ?? organizations[0];
      counts.set(selected, (counts.get(selected) ?? 0) + 1);
    }

    const values = [...counts.values()];
    const min = Math.min(...values);
    const max = Math.max(...values);

    expect(max / min).toBeGreaterThan(100);
  });

  it('moves the corrected cursor only across the contiguous prefix that actually produced claims', () => {
    const advance = (
      currentCursor: number,
      visitedOrganizations: number[],
      claimedOrganizations: number[],
    ) => {
      const claimed = new Set(claimedOrganizations);
      let nextCursor = currentCursor;

      for (const organization of visitedOrganizations) {
        if (!claimed.has(organization)) break;
        nextCursor = organization;
      }

      return nextCursor;
    };

    expect(advance(0, [1, 2, 3], [])).toBe(0);
    expect(advance(0, [1, 2, 3], [2, 3])).toBe(0);
    expect(advance(0, [1, 2, 3], [1, 3])).toBe(1);
    expect(advance(0, [1, 2, 3], [1, 2, 3])).toBe(3);
  });

  it('requires claim-coupled progress and contention lanes instead of the singleton random fallback', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    expect(phase14).toContain(
      'drop constraint if exists onesignal_outbox_claim_fairness_state_singleton',
    );
    expect(phase14).toContain(
      'create sequence if not exists private.onesignal_outbox_claim_fairness_lane_seq',
    );

    expect(claim).not.toBe('');
    expect(claim).toContain('fairness_lane_id');
    expect(claim).not.toContain('fallback_cursor:=gen_random_uuid()');
    expect(claim).toContain(
      'insert into private.onesignal_outbox_claim_fairness_state',
    );
    expect(claim).toContain('returning id into fairness_lane_id');
    expect(claim).toContain(
      'served_organizations as ( select distinct c.organization_id from claimed c',
    );
    expect(claim).toContain('first_unserved');
    expect(claim).toContain('advance_target');
    expect(claim).toContain('from claimed effective_claim');
    expect(claim).toContain('where s.id=fairness_lane_id');
  });
});
