# Durable Outbox V2 — phase 27

Base: `99c9992265b33f11656bb3f81d084ecfd4661ae2`. Regression proof commit: `82eb69e`.
Branch: `fix/verification-round-2`; PR #2 stays Draft. No remote migration or manual deployment.

## Proven regression and limits of evidence

Phase 26 added two `brin_summarize_new_values` calls after retention DELETEs in the same transaction. PostgreSQL traverses the entire BRIN revmap and scans every unsummarized range. Neither `_batch_limit` nor the existing advisory lock bounds this work. The existing DELETE/sealing row locks and uncommitted retention changes remain outstanding for the extra rescue duration. A maintenance lock wait could also delay completion without a local bound.

The executable fixture loads the actual cleanup function with minimal local tables and real BRIN minmax-multi indexes (`pages_per_range=8`, `values_per_range=64`). It runs PostgreSQL 17.5 WASM through PGlite 0.3.14, single session, not Supabase production. Native PostgreSQL startup was unavailable because this container cannot switch to a non-root UID. No multi-session contention or actual pg_cron scheduling benchmark is claimed.

| Rows per table | Heap pages, outbox / attempts | Old cleanup | Old cleanup with summaries already present | New summaries created by old rescue |
|---|---|---|---|---|
| 100,000 | 4,000 / 4,167 | 172 ms | 57 ms | 499 + 520 |
| 500,000 | 20,000 / 20,834 | 864 ms | 213 ms | 2,499 + 2,604 |

These are individual local runs, not production latency estimates. They establish real additional work proportional to backlog. They do **not** demonstrate a 600-second overrun. For an extreme analytical case of 3.2M pages per table, the old path can visit 800,000 ranges across both indexes and scan about 48.8 GiB of heap coverage in one transaction if all ranges are unsummarized. Actual elapsed time depends on storage, cache, tuple density and concurrent load; no fabricated time extrapolation is used.

## Locks and overlap

PostgreSQL 17 source takes `ShareUpdateExclusiveLock` on heap and BRIN during the summarize call. It explicitly releases these relation locks before returning: they are **not** inherently held until commit by this function. They conflict with VACUUM/ANALYZE and other maintenance, but are compatible with normal RowExclusive DML relation locks. Thus DELETE/INSERT contention is not a blanket table-write block; resource competition and retained prior DELETE row locks are the relevant effects.

The cleanup already uses `pg_try_advisory_xact_lock`: another transaction calling it returns busy. pg_cron also runs only one instance of a given job at a time and queues the next invocation. Therefore no duplicate same-job cleanup execution was proved; a long call risks delayed/queued ticks, while the separately scheduled runner may run concurrently and compete for resources. Advisory protection was preserved.

## Correction

Edited the existing **unapplied** phase-10 migration, matching phase 26's location:

- Use `brin_summarize_range` for at most 1,024 **visits per index**, including already summarized ranges.
- Persist a per-index page cursor atomically with the cleanup transaction; reset for index recreation, out-of-range cursor after truncation, and wrap at EOF.
- Derive actual pages-per-range from index options. For the deployed DDL shape (ppr=8, 8 KiB blocks), at most 64 MiB of heap coverage per index per tick, excluding metadata and possible internal retries.
- Check a cooperative 250 ms deadline between calls per index. This is **not** a hard duration guarantee: a single range's I/O can overrun, and retention itself still has its pre-existing costs.
- Cap maintenance lock waits at 100 ms, preserving a stricter caller setting and restoring it afterwards. Catch only `55P03` in an index-local subtransaction: rollback its summaries/cursor, preserve prior retention, report a lock skip. Other errors and external cancellations propagate.
- Cursor table is private, RLS-enabled and revoked from public/anon/authenticated/service_role; the existing SECURITY DEFINER maintenance function owns access.
- Preserve existing summary counters; add visit and lock-skip counters. No enqueue/claim/runner/health summarization added.

The phase-26 contract now checks incremental queue-independent rescue rather than demanding the unbounded API. Phase-24 foreground prohibition remains intact.

## Validation and trade-off

New 500k-row run: 719 ms total (individual WASM run), 1,023 new summaries per index over 1,024 visits, then the next tick advances both cursors from page 8,192 to 16,384 and creates 1,024 summaries each. 452 + 557 ranges remain after those two ticks; the fixture's explicit final full summarize measures this remainder and is **not** production cleanup code. The bounded path intentionally spreads work across ticks, so latency alone is not the success criterion.

Runtime fixture passes: retention row deleted; bounded visit counts; resume over multiple ticks; caller rollback restores cursor; injected 55P03 on the second summarize preserves retention and rolls back only the affected index cursor; caller `lock_timeout=20ms` restored; truncate reset; absent indexes safe. Fault injection verifies PL/pgSQL exception behavior, not real lock scheduling.

Backlog recovery is no longer guaranteed in one 10-minute tick. For 400,000 ranges per index, a complete pass needs **at least 391 ticks (~65h10m)** at 1,024 visits/tick, absent faster VACUUM/autosummarize; time budgets/lock skips may increase this. Sustained range creation above service capacity can outgrow rescue. This is an explicit capacity trade-off requiring deployment sizing, not a claim that health recovers within ten minutes. Next scope: recovery throughput, old summarized prefixes, and sustained burst fairness.

Reproduce (temporary dependency, no application dependency change):

```sh
npm install --prefix /tmp/phase27-harness @electric-sql/pglite@0.3.14
PGLITE_MODULE=/tmp/phase27-harness/node_modules/@electric-sql/pglite/dist/index.js node tools/audits/outbox-phase27.mjs
npx vitest run src/lib/oneSignalDurableOutboxV2Brin*.test.ts
```

Before correction: new contract 3/3 FAIL. After correction: BRIN contracts 20/20 PASS. Raw engine output is in `before.jsonl` / `after.jsonl`.

Primary sources checked:
- https://www.postgresql.org/docs/17/brin.html
- https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/access/brin/brin.c (`brin_summarize_new_values`, `brin_summarize_range`, `brinsummarize`)
- https://github.com/citusdata/pg_cron (same-job serialization / queueing)
- https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes (reviewed; listed changes do not alter this BRIN API)

Final local gate: 101/101 Vitest files, 1,174/1,174 tests; companion smoke 12/12; production build PASS (10.20s); `git diff --check` PASS. Known jsdom window.open diagnostic was non-failing. Remote CI is checked separately on the pushed HEAD.
