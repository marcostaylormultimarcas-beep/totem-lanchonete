import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const phase13 = readFileSync(
  join(
    migrationsDir,
    '20261001160000_visionfood_v2_onesignal_durable_outbox_claim_liveness_phase13.sql',
  ),
  'utf8',
);

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
const sql = normalize(phase13);

describe('OneSignal Durable Outbox V2 phase 14 claim cursor atomicity/liveness', () => {
  it('proves phase13 can advance the durable cursor from the visited window even when no row is effectively claimed', () => {
    expect(sql).toContain('advance_fairness_cursor as ( update private.onesignal_outbox_claim_fairness_state');
    expect(sql).toMatch(
      /select active_org\.organization_id from active_organizations active_org order by active_org\.organization_ordinal desc limit 1/,
    );
    expect(sql).not.toMatch(
      /advance_fairness_cursor[\s\S]*from claimed/,
    );

    const previousCursor = 'org-000';
    const visitedOrganizations = ['org-001', 'org-002'];
    const claimedOrganizations: string[] = [];

    const phase13Cursor =
      visitedOrganizations.at(-1) ?? previousCursor;

    expect(claimedOrganizations).toHaveLength(0);
    expect(phase13Cursor).toBe('org-002');
    expect(phase13Cursor).not.toBe(previousCursor);
  });

  it('proves a skipped organization can wait until wrap-around after its lock holder rolls back', () => {
    const organizations = [1, 2, 3, 4, 5, 6];
    const batchSize = 2;
    let cursor = 0;

    const firstWindow = organizations.filter((org) => org > cursor).slice(0, batchSize);
    expect(firstWindow).toEqual([1, 2]);

    // org 1 is SKIP LOCKED by another transaction. The other transaction later
    // rolls back, so nobody actually claims org 1.
    const effectivelyClaimed = [2];
    expect(effectivelyClaimed).toEqual([2]);

    // Phase 13 advances to the last visited organization, not the served one set.
    cursor = firstWindow.at(-1) ?? cursor;

    const secondWindow = organizations.filter((org) => org > cursor).slice(0, batchSize);
    cursor = secondWindow.at(-1) ?? cursor;
    const thirdWindow = organizations.filter((org) => org > cursor).slice(0, batchSize);

    expect(secondWindow).toEqual([3, 4]);
    expect(thirdWindow).toEqual([5, 6]);
    expect(secondWindow).not.toContain(1);
    expect(thirdWindow).not.toContain(1);
  });

  it('proves the random UUID fallback is biased by UUID keyspace gaps and is used while the singleton row is locked', () => {
    expect(sql).toContain('fallback_cursor:=gen_random_uuid()');
    expect(sql).toMatch(/for update of s skip locked/);

    // Numeric analogue of UUID ordering. With batch=1, the next organization
    // after a uniformly random cursor is selected. Selection probability is
    // proportional to the preceding keyspace gap, not equally distributed.
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

  it('requires fairness progress to be coupled to effective claims without a transaction-long singleton cursor lock', () => {
    expect(sql).not.toMatch(/for update of s skip locked/);
    expect(sql).not.toContain('fallback_cursor:=gen_random_uuid()');
    expect(sql).toMatch(/from claimed/);
  });
});
