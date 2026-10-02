# Durable Outbox V2 — phase 35

Base: `b7db41ba5fc40d9f6846ee3c4326f214fc24741c`.

Scope: audit only the cumulative completion-overrun risk across the two final BRIN rescue calls when each health index receives its own 250 ms cooperative call-start deadline. No completed phase was re-audited. No remote migration, manual deployment, merge, or ready-for-review.

## Regression proven before correction

Phase 34 correctly established that one already-authorized `brin_summarize_range` call needs about 599.75 seconds of post-start work to reach the next 10-minute cleanup tick by itself.

The phase-35 gap is cumulative: the cleanup resets `rescue_deadline` independently for each of the two BRIN indexes. Therefore a long final call in index 1 can return minutes later, after which index 2 receives a fresh 250 ms call-start window and can authorize a second long final call.

With both final calls starting at 249.999 ms inside their respective index windows:

- cleanup cadence: 600,000 ms;
- cooperative deadline per index: 250 ms;
- equal post-start stall required per call to reach the next tick cumulatively:
  **299,750.001 ms**;
- equivalent per call: about **4 min 59.75 s**;
- each stall is individually below 10 minutes;
- together, including the two independent call-start windows, they reach **600,000 ms** exactly.

A simpler 5-minute + 5-minute pair reaches about **600,499.998 ms** from BRIN rescue start.

Because retention/DELETE runs before rescue in the same cleanup statement/transaction, that cumulative rescue time delays commit of already-performed retention work and can reach the next scheduled cleanup tick. pg_cron still serializes executions of the same job, so the consequence is a delayed/queued next cleanup invocation, not proven same-job concurrency.

Regression proof commit: `5f03841710b22269222e79997e4ff9438225af94`.

## Narrow correction

Runtime change commit: `f48ce816b790a63b733115a8b88a2d46c87be25a`.

The cleanup now keeps the existing 250 ms cooperative deadline for each BRIN index and adds one aggregate 500 ms call-start envelope across both indexes:

- normal case: two indexes still have the same nominal combined 2 × 250 ms rescue allowance;
- if index 1 finishes within its own budget, index 2 can still use the remaining aggregate window;
- if a legitimate final call in index 1 overruns by minutes after lock acquisition, the aggregate deadline is already expired when it returns, so index 2 cannot authorize another BRIN call;
- no hard timeout is introduced;
- no transaction boundary, cron schedule, advisory lock, retention ordering, cursor schema, or BRIN page-range policy changes.

This removes the newly proven **two-call cumulative** hazard without claiming to eliminate the phase-34 residual single-call completion overrun. One final already-authorized call can still run past its call-start deadline; crossing the 10-minute cadence with that single call still requires roughly 9 min 59.5 s when it starts near the aggregate 500 ms boundary.

## Validation artifacts

- `src/lib/oneSignalDurableOutboxV2BrinTwoIndexCumulativeOverrun.contract.test.ts`
- `tools/audits/outbox-phase35.mjs`

The contract test statically verifies the 500 ms aggregate guard is present on all three BRIN call authorization paths and models the before/after cumulative threshold. The audit model verifies both the exact ~299.75 s equal-stall threshold and the 5-minute-per-index example.

No remote migration was applied. No manual deploy, merge, or ready-for-review action was performed.
