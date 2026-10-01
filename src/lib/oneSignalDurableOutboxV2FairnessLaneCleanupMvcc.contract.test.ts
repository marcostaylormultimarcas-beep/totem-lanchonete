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

type Lane = {
  id: number;
  recency: number;
};

function newestCutoff(lanes: Lane[], keep: number): Lane | undefined {
  return [...lanes]
    .sort((a, b) => b.recency - a.recency || b.id - a.id)
    [keep - 1];
}

function isOlderThan(lane: Lane, cutoff: Lane): boolean {
  return (
    lane.recency < cutoff.recency ||
    (lane.recency === cutoff.recency && lane.id < cutoff.id)
  );
}

describe('OneSignal Durable Outbox V2 phase 17 fairness lane cleanup MVCC snapshot', () => {
  it('keeps each cutoff and its locking candidate scan inside one data-modifying statement', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    const pressureStart = claim.indexOf(
      'with pressure_cleanup_cutoff as materialized',
    );
    const pressureDelete = claim.indexOf(
      'delete from private.onesignal_outbox_claim_fairness_state s',
      pressureStart,
    );
    const idleStart = claim.indexOf(
      'with idle_cleanup_cutoff as materialized',
      pressureDelete + 1,
    );
    const idleDelete = claim.indexOf(
      'delete from private.onesignal_outbox_claim_fairness_state s',
      idleStart,
    );

    expect(pressureStart).toBeGreaterThanOrEqual(0);
    expect(pressureDelete).toBeGreaterThan(pressureStart);
    expect(idleStart).toBeGreaterThan(pressureDelete);
    expect(idleDelete).toBeGreaterThan(idleStart);

    const pressureStatement = claim.slice(pressureStart, idleStart);
    const idleStatement = claim.slice(idleStart, claim.indexOf('return query'));

    expect(pressureStatement).toContain(
      'pressure_cleanup_cutoff as materialized',
    );
    expect(pressureStatement).toContain(
      'cross join pressure_cleanup_cutoff cutoff',
    );
    expect(pressureStatement).toContain('for update of s skip locked');
    expect(pressureStatement).toContain(
      'using pressure_cleanup_candidates cleanup',
    );

    expect(idleStatement).toContain('idle_cleanup_cutoff as materialized');
    expect(idleStatement).toContain('cross join idle_cleanup_cutoff cutoff');
    expect(idleStatement).toContain('for update of s skip locked');
    expect(idleStatement).toContain('using idle_cleanup_candidates cleanup');

    // A separate PL/pgSQL SELECT INTO cutoff followed by DELETE would allow a
    // later command snapshot to drift away from the cutoff snapshot.
    expect(claim).not.toContain('into pressure_cleanup_cutoff');
    expect(claim).not.toContain('into idle_cleanup_cutoff');
  });

  it('cannot over-delete the soft pool when inserts commit after the cleanup snapshot', () => {
    const keep = 32;
    const snapshot = Array.from({ length: 48 }, (_, index) => ({
      id: index + 1,
      recency: index + 1,
    }));

    const cutoff = newestCutoff(snapshot, keep);
    expect(cutoff).toBeDefined();

    const visibleDeleteCandidates = snapshot.filter((lane) =>
      isOlderThan(lane, cutoff!),
    );

    // New commits are invisible to the already-running command snapshot. They
    // add capacity; they do not make any protected snapshot row deletable.
    const concurrentInserts = Array.from({ length: 20 }, (_, index) => ({
      id: 100 + index,
      recency: 100 + index,
    }));

    const survivors = [
      ...snapshot.filter(
        (lane) => !visibleDeleteCandidates.some((c) => c.id === lane.id),
      ),
      ...concurrentInserts,
    ];

    expect(snapshot.length - visibleDeleteCandidates.length).toBe(keep);
    expect(survivors.length).toBe(keep + concurrentInserts.length);
  });

  it('keeps concurrent cleaners bounded by their protected cutoff even when they partition candidates', () => {
    const keep = 32;
    const snapshot = Array.from({ length: 80 }, (_, index) => ({
      id: index + 1,
      recency: index + 1,
    }));

    const cutoff = newestCutoff(snapshot, keep)!;
    const candidates = snapshot.filter((lane) => isOlderThan(lane, cutoff));

    // SKIP LOCKED may partition this set among several cleaners. The union can
    // consume every row older than the cutoff but none of the protected set.
    const cleanerA = candidates.filter((_, index) => index % 3 === 0);
    const cleanerB = candidates.filter((_, index) => index % 3 === 1);
    const cleanerC = candidates.filter((_, index) => index % 3 === 2);
    const deletedIds = new Set(
      [...cleanerA, ...cleanerB, ...cleanerC].map((lane) => lane.id),
    );

    const protectedRows = snapshot.filter(
      (lane) => !isOlderThan(lane, cutoff),
    );

    expect(protectedRows).toHaveLength(keep);
    expect(protectedRows.some((lane) => deletedIds.has(lane.id))).toBe(false);
    expect(snapshot.length - deletedIds.size).toBe(keep);
  });

  it('treats a concurrent recency promotion as under-cleanup, not over-delete', () => {
    const keep = 8;
    const snapshot = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      recency: index + 1,
    }));

    const cutoff = newestCutoff(snapshot, keep)!;
    const oldCandidate = snapshot.find((lane) => isOlderThan(lane, cutoff))!;
    expect(oldCandidate).toBeDefined();

    // Model PostgreSQL READ COMMITTED target-row recheck: after a concurrent
    // UPDATE commits, the locking command applies its WHERE predicate to the
    // updated row version. A lane promoted to "now" is no longer older than
    // the statement's cutoff and therefore must not be deleted.
    const promoted = { ...oldCandidate, recency: 1000 };

    expect(isOlderThan(oldCandidate, cutoff)).toBe(true);
    expect(isOlderThan(promoted, cutoff)).toBe(false);

    const remainingCandidates = snapshot
      .filter((lane) => lane.id !== oldCandidate.id)
      .filter((lane) => isOlderThan(lane, cutoff));

    expect(remainingCandidates.length).toBe(
      snapshot.length - keep - 1,
    );
    expect(snapshot.length - remainingCandidates.length).toBe(keep + 1);
  });

  it('makes concurrent deletes only reduce work for a stale command snapshot', () => {
    const keep = 8;
    const snapshot = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      recency: index + 1,
    }));

    const cutoff = newestCutoff(snapshot, keep)!;
    const candidates = snapshot.filter((lane) => isOlderThan(lane, cutoff));

    // Another cleaner can delete some rows first. A stale snapshot may still
    // have identified them, but DELETE/locking cannot remove the same physical
    // rows twice; its effective work is the remaining candidate subset.
    const alreadyDeleted = new Set(candidates.slice(0, 5).map((lane) => lane.id));
    const effectiveDeletes = candidates.filter(
      (lane) => !alreadyDeleted.has(lane.id),
    );

    const liveRows = snapshot.filter((lane) => !alreadyDeleted.has(lane.id));
    const survivors = liveRows.filter(
      (lane) => !effectiveDeletes.some((c) => c.id === lane.id),
    );

    expect(survivors).toHaveLength(keep);
    expect(
      survivors.every((lane) => !isOlderThan(lane, cutoff)),
    ).toBe(true);
  });

  it('allows temporary under-cleanup but converges on the next statement snapshot', () => {
    const keep = 32;
    const firstSnapshot = Array.from({ length: 48 }, (_, index) => ({
      id: index + 1,
      recency: index + 1,
    }));

    const firstCutoff = newestCutoff(firstSnapshot, keep)!;
    const firstCandidates = firstSnapshot.filter((lane) =>
      isOlderThan(lane, firstCutoff),
    );

    // Simulate half the candidates being locked and skipped.
    const firstPassDeleted = firstCandidates.filter(
      (_, index) => index % 2 === 0,
    );
    const afterFirstPass = firstSnapshot.filter(
      (lane) => !firstPassDeleted.some((c) => c.id === lane.id),
    );

    expect(afterFirstPass.length).toBeGreaterThan(keep);

    const secondCutoff = newestCutoff(afterFirstPass, keep)!;
    const secondPassCandidates = afterFirstPass.filter((lane) =>
      isOlderThan(lane, secondCutoff),
    );
    const afterSecondPass = afterFirstPass.filter(
      (lane) => !secondPassCandidates.some((c) => c.id === lane.id),
    );

    expect(afterSecondPass).toHaveLength(keep);
  });

  it('preserves monotonic recency and keeps cursor state outside cleanup predicates', () => {
    const claim = latestFunctionDefinition(
      'private',
      'visionfood_onesignal_outbox_claim',
    );

    const cleanupStart = claim.indexOf(
      'with pressure_cleanup_cutoff as materialized',
    );
    const returnQueryStart = claim.indexOf('return query');
    const cleanupSection = claim.slice(cleanupStart, returnQueryStart);

    expect(claim).toContain('set updated_at=pg_catalog.clock_timestamp()');
    expect(cleanupSection).not.toContain('set updated_at=');
    expect(cleanupSection).not.toContain('last_organization_id');
    expect(cleanupSection).not.toContain('fairness_progress');
    expect(claim).toContain("o.status in ('pending','retry')");
    expect(claim).toContain('from claimed effective_claim');
  });
});
