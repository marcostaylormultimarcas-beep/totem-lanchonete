# Durable Outbox V2 — phase 31

Base: `9a5bde7041094143e6ca64347e592f610420f44b`.
Regression proof commit: `80bf8bd00fb0301060b119270d0d276f975ea0c3`.
Correction commit: `a62a17470b80fc5a31a6356591b0000d9f6c691e`.
Audit-model commit: `761c5b5790d17225b0c9342ca119a95c821b6d37`.
Branch: `fix/verification-round-2`; PR #2 remains Draft/Open. No remote migration, manual deployment, merge, or ready-for-review.

## Regression proven before correction

Phase 30 made the fairness repayment additive in **visit count**:

- normal tick: at most 1,024 BRIN range visits;
- `history_due` tick: one forced historical visit plus the normal 1,024 tail capacity, for at most 1,025 visits.

That fixes the purely visit-bound 1,024/tick regression, but the same historical visit still consumed the single 250 ms cooperative deadline.

A deterministic short-deadline reproduction uses a representative 0.2442 ms per visit. That is deliberately just above `250 / 1024`, so 1,024 calls can be started under the cooperative deadline but the clock is binding at the boundary.

With sustained arrivals of exactly 1,024 fresh ranges/tick before the phase-31 correction:

- no-debt tick: 1,024 tail + 0 history, backlog unchanged;
- debt tick: 1 history + only 1,023 tail before the deadline, backlog +1.

Eight-tick backlog:

`0,1,1,2,2,3,3,4`.

So the additive 1,025 visit cap was not sufficient when the time budget, rather than the visit budget, became authoritative. The phase-29 `history_due` alternation could still reduce effective fresh-tail capacity to 1,023.5/tick at the nominal 1,024/tick boundary.

The proof was committed first in `oneSignalDurableOutboxV2BrinRescueDeadlineCapacity.contract.test.ts`; it fails against the phase-30 source and passes only after the bounded deadline refund exists.

## Correction

The forced historical repayment now records its own start time. After that one call completes, the cleanup adds back **only the time consumed by that forced history call**, capped at 100 ms:

- the 1,025 visit maximum is unchanged;
- the 250 ms ordinary rescue budget is unchanged;
- only the history-debt call is treated as additive in time;
- the refund cannot exceed the existing 100 ms maintenance lock-wait envelope.

This preserves the phase-29 historical fairness guarantee and the phase-30 1,024 fresh-tail capacity guarantee when the deadline is just binding, without opening an unbounded second maintenance window.

## Boundary/backlog results

With the same 0.2442 ms deterministic boundary model after correction:

- 1,023 arrivals/tick: backlog `0,0,0,0,0,0,0,0`;
- 1,024 arrivals/tick: backlog `0,0,0,0,0,0,0,0`;
- 1,025 arrivals/tick: backlog `1,2,3,4,5,6,7,8`.

At 1,024/tick, `history_due` still alternates, but every debt tick performs exactly:

- 1 historical visit;
- 1,024 tail visits;
- 1,025 total visits.

For the variable arrival sequence:

`1023,1024,1025,1024,1023,1025,1024,1023`

the corrected backlog is:

`0,0,1,1,0,1,1,0`.

That is exactly the queue expected from a 1,024-range/tick fresh-tail capacity. The fairness state no longer injects extra backlog oscillation.

## Cleanup cost and overlap

The phase-31 refund does **not** raise the visit cap beyond 1,025.

On a fast path where each visit costs 0.2 ms, both phase 30 and phase 31 execute the same number of calls on debt ticks and stop at the 1,025 visit cap. The refund therefore does not add work when the visit cap is already authoritative.

Under the deliberately pessimistic dense-lock model already used in phase 30:

- cooperative deadline: 250 ms;
- lock wait per blocked call: 100 ms;
- phase-30 debt tick: 3 attempts, modeled elapsed 300 ms;
- phase-31 debt tick: 4 attempts, modeled elapsed 400 ms.

The bounded refund therefore adds at most one extra 100 ms lock-wait attempt per debt index in this model. Across both rescued BRIN indexes the modeled incremental envelope is 200 ms.

The cleanup cron runs every 10 minutes (600,000 ms), so 200 ms is about 0.0333% of one schedule interval. That does not create a material overlap risk by itself.

This is still a cooperative model, not a hard runtime ceiling. A `brin_summarize_range` call that acquires its locks and then stalls on slow I/O can overrun the deadline, as documented in phases 27 and 30. Phase 31 does not claim to bound that pre-existing PostgreSQL behavior.

## Capacity metric interpretation

`brin_rescue_range_visits` remains an **actual maintenance-work counter**, not a fresh-tail throughput metric.

A debt tick may legitimately report 1,025 visits for one index while fresh-tail service remains exactly 1,024:

- 1 history;
- 1,024 tail.

No production metric rename or schema change was made because the counter itself is accurate. The phase-31 model records tail/history/total visits separately so operational capacity is not inferred from the aggregate counter alone.

## Validation

Executable deterministic model: `tools/audits/outbox-phase31.mjs`.

Contract: `src/lib/oneSignalDurableOutboxV2BrinRescueDeadlineCapacity.contract.test.ts`.

The model proves the phase-30 short-deadline regression, validates the corrected 1,023–1,025 boundary behavior, checks alternating `history_due`, confirms the 1,025 hard visit cap, and quantifies the dense-lock incremental time envelope.

No remote migration was applied.
