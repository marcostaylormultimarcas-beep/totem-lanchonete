# Durable Outbox V2 — phase 37

Base: `68ad481d8dfb4dde16da3c279d17f826da01bb51`.

Scope: audit only the robustness of the phase-36 two-BRIN first-position rotation when cleanup executions are delayed or queued. This phase does not reopen the phase-34 single-call overrun analysis or the phase-36 aggregate-envelope starvation regression already fixed.

Branch: `fix/verification-round-2`; PR #2 remains open/draft. No remote migration, manual deployment, merge, or ready-for-review action was performed.

## Regression proven before correction

Phase 36 selected the first BRIN from the parity of:

`floor(extract(epoch from statement_timestamp()) / 600) % 2`.

That is a wall-clock bucket, not an execution sequence.

pg_cron executes at most one instance of a specific job at a time and queues later runs. Its minute-based scheduler tracks pending runs, so delayed/pending cleanup executions may start back-to-back after the scheduling pressure clears. Multiple executions can therefore begin inside the same 10-minute bucket.

The deterministic phase-37 model uses queued starts in buckets:

`[2, 2, 2, 2, 4, 4, 4, 4]`.

Every bucket is even. The phase-36 wall-clock rule therefore chooses the same first BRIN on all eight executions, giving first-position opportunities `[8, 0]`. Under the shared 500 ms aggregate envelope, that can reintroduce persistent operational preference for the same index if the first index repeatedly consumes the envelope.

A sequence-based alternation over those same eight executions gives `[4, 4]`.

Regression proof commit: `d81016bf75c9969e8111256826126758daafc90f`.

## Narrow correction

Runtime correction commit: `11f4b1fa506b235fd93b3f2c1d9c165ab3fe6f2f`.

The cleanup now reuses the existing internal `private.onesignal_brin_rescue_cursor` state and adds one bounded-purpose field:

`priority_first_count bigint not null default 0`.

Before BRIN rescue begins, existing BRIN indexes are represented in the cursor table. The cleanup chooses the index with the lower `priority_first_count` as first, breaks ties deterministically in favor of the outbox index, increments only that chosen index, and then processes the two indexes in that order.

The cleanup already holds `visionfood:onesignal_outbox_v2_cleanup` through `pg_try_advisory_xact_lock`, so first-position counter selection/increment is serialized without a new lock, job, transaction boundary, timeout, or table.

The phase-35 500 ms aggregate call-start envelope and each per-index 250 ms cooperative deadline remain unchanged.

## Compatibility and validation artifacts

Phase-36 contract compatibility commit: `784aac8ea6f4dea03c5eebbf68b5ac486a369334`.

Phase-37 contract commit: `565e26ce0a63b03c412f64a4f0e7b0fca3009973`.

Artifacts:

- `tools/audits/outbox-phase37.mjs`
- `src/lib/oneSignalDurableOutboxV2BrinQueuedPriorityFairness.contract.test.ts`

The phase-37 contract verifies:

- queued same-parity wall-clock starts can collapse the old rule to `[8, 0]`;
- sequence alternation remains `[4, 4]`;
- the old `statement_timestamp()/600` priority rule is absent from cleanup;
- the persisted first-position counter is present and incremented;
- the phase-35 aggregate 500 ms guards remain present.

No remote migration was applied. No manual deployment, merge, or ready-for-review action was performed.
