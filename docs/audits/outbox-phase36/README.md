# Durable Outbox V2 — phase 36

Base: `d877a09bda61e5c2c57756060e9a717a5ecf89ab`.

Scope: audit only the residual fairness risk introduced by the phase-35 aggregate 500 ms BRIN rescue call-start envelope. Specifically, verify whether fixed index order can let the first BRIN index repeatedly consume the aggregate envelope and operationally starve the second index under sustained load. This phase does not reopen the phase-34 single-call completion-overrun analysis.

Branch: `fix/verification-round-2`; PR #2 remains open/draft. No remote migration, manual deployment, merge, or ready-for-review.

## Regression proven before correction

Phase 35 correctly prevents two independent long final calls from compounding across the two BRIN indexes by sharing one aggregate 500 ms call-start envelope.

The residual gap is cross-index fairness: the order was fixed on every cleanup tick:

1. `private.onesignal_outbox_health_created_idx`
2. `private.onesignal_outbox_attempts_health_created_idx`

Each index still has a local 250 ms cooperative call-start deadline. Therefore the first index can legitimately start its final range call just before 250 ms. If that call finishes just after the aggregate 500 ms boundary, the second index gets no BRIN call-start opportunity for that tick.

Deterministic threshold used by the regression model:

- first final call starts at `249.999 ms`;
- post-start work: `250.002 ms`;
- first final call finishes at `500.001 ms`;
- aggregate envelope: `500 ms`.

That is enough to skip the second index. No stall remotely close to the 10-minute cleanup cadence is needed.

Under eight sustained ticks with the same fixed order, the scheduler model produces BRIN rescue opportunities `[8, 0]`: the first index progresses every tick while the second receives zero opportunities.

This is distinct from phase 34. Phase 34 established that a single already-authorized call can overrun its cooperative deadline and would need roughly 10 minutes to reach the next cleanup schedule. Phase 36 proves a new consequence introduced by the shared envelope: a roughly 500 ms total rescue duration can repeatedly suppress the same second index.

Regression proof commit: `839e71a5ef6c06f96515271cfd8525d72e64630e`.

## Narrow correction

Runtime correction commit: `1e0b6a0ff8884b77bdd88720abc24b6ba5b70662`.

The cleanup now alternates which BRIN index is first on successive 10-minute wall-clock buckets, using the existing cleanup cadence and `statement_timestamp()`:

- even 10-minute bucket: outbox health index first;
- odd 10-minute bucket: attempts health index first.

The aggregate 500 ms deadline is unchanged. Each index's 250 ms cooperative deadline is unchanged. The three aggregate call-start guards are unchanged.

Under the same eight-tick sustained-pressure model, opportunities become `[4, 4]`. If the first index consumes the envelope on every tick, the identity of that first index alternates, so neither BRIN index can be permanently starved by fixed ordering.

The correction deliberately adds no persistent state, hard timeout, transaction boundary, cron job, advisory-lock change, cursor-schema change, or BRIN range-policy change.

## Validation artifacts

- `src/lib/oneSignalDurableOutboxV2BrinAggregateEnvelopeFairness.contract.test.ts`
- `tools/audits/outbox-phase36.mjs`

The audit model verifies:

- pre-fix fixed-order opportunities: `[8, 0]`;
- post-fix rotating-order opportunities: `[4, 4]`;
- starvation threshold example finishes at `500.001 ms`.

The contract test verifies the phase-35 500 ms aggregate guard remains present and requires cross-index order rotation tied to the 10-minute cadence.

At the time this report was written, the repository's standard GitHub verification workflows for the runtime correction were still running. The deterministic phase-36 model itself passes locally.

No remote migration was applied. No manual deployment, merge, or ready-for-review action was performed.
