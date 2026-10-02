# Durable Outbox V2 — phase 34

Base: `087b62c82d4fa526d904998715a423854c80ebb6`.

Scope: audit the residual risk that one `brin_summarize_range` call legitimately started before the 250 ms cooperative deadline can remain in post-lock slow I/O long enough to delay the transaction commit for retention/DELETE or cross the next 10-minute cleanup schedule. No completed phase was re-audited. No remote migration, manual deployment, merge, or ready-for-review.

## Result

The residual completion-overrun hazard is structurally real, but **no new material operational regression was proven**, so the runtime migration is unchanged.

The current cleanup still has a cooperative **call-start** deadline, not a hard completion deadline. A call that starts before 250 ms is allowed to finish even if it runs past that boundary. Because retention/DELETE executes earlier in the same function/transaction, an extreme late call would postpone commit of those already-performed changes until the statement completes or aborts.

This is not newly introduced by phase 32 or phase 33. Phase 27 already documented that the 250 ms budget is cooperative and that one range may overrun it. Phase 32 removed the separate refund window that could authorize an *additional* BRIN call after the original deadline; it did not create or remove the pre-existing completion-overrun property of the final already-authorized call.

## Threshold for one call to reach the next scheduled tick

Cleanup cadence: 10 minutes = 600,000 ms.

For the latest legitimate start just below the cooperative boundary, modeled as 249.999 ms:

- required post-start duration to reach 600,000 ms: **599,750.001 ms**;
- equivalent: **599.750001 s**, about **9 min 59.75 s** of one call after it has already started;
- a 300 ms call finishes around 0.55 s from index-budget start;
- a 5-minute call finishes around 5 min 0.25 s and does not by itself reach the next tick.

This is a threshold calculation, not a production latency measurement.

## Work scope of the call

The two health BRIN indexes remain `pages_per_range=8`. PostgreSQL's `brin_summarize_range` processes the single page range containing the requested block. Therefore the residual scenario is one targeted 8-page heap range plus the associated BRIN/index work, not an unbounded full-index `brin_summarize_new_values` sweep.

The audit found no measured production or local-engine evidence of one such range call taking close to 10 minutes. Without such evidence, treating the theoretical completion overrun as a newly proven operational regression would overstate the evidence.

## Same-job overlap versus delay

Crossing the next wall-clock schedule does **not** imply two instances of the same cleanup job execute concurrently. pg_cron documents that only one instance of a specific job runs at a time; a later invocation is queued until the current instance finishes.

Therefore the demonstrated residual consequence is:

- delayed transaction commit for the retention/DELETE work already performed;
- a delayed/queued subsequent cleanup run if the current execution spans the schedule boundary;
- not proven same-job cleanup overlap.

The independent 15-second runner remains a separate job and was outside this narrow phase-34 scope.

## Alternatives re-evaluated

### Effective timeout around the BRIN call

`lock_timeout` only bounds time waiting to acquire locks; it does not bound slow I/O after acquisition.

A `statement_timeout` configured *inside* the already-running cleanup statement does not provide a reliable per-call start-to-finish bound for the current top-level command. Applying a hard timeout at the cron command/session boundary would bound the whole cleanup statement, not just BRIN rescue, and an expiry would abort/roll back the transaction including retention changes. That is a materially different failure mode, not a narrow correction justified by this audit.

### Separate retention/DELETE from BRIN rescue

A separate transaction/job would let retention commit independently of rescue, but it changes transaction boundaries, scheduling, locking, failure semantics and observability. No new regression evidence justifies that architectural split in this phase.

## Validation artifacts

- `src/lib/oneSignalDurableOutboxV2BrinSingleCallOverrun.contract.test.ts`
- `tools/audits/outbox-phase34.mjs`

The executable model proves the exact single-call threshold at the current 10-minute cadence and 250 ms cooperative boundary. Static contract checks prove the current runtime keeps the no-refund behavior, uses targeted `brin_summarize_range`, preserves `pages_per_range=8`, leaves retention before rescue, and does not add an in-function hard statement timeout.

No runtime SQL was changed. No remote migration was applied.
