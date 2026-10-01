# Durable Outbox V2 — phase 30

Base: `069f11538ccb8fd72bbb084bba3e31da45eadd93`.
Regression proof commit: `9eadff54f0b3587ad1be04f73d514d462512c315`.
Correction commit: `bf52cdc42082e7277b5c3094ca6c97abae57cbc5`.
Audit-model commit: `8e8900f02da99199f5a1e441be1f5af859b4cdf5`.
Branch: `fix/verification-round-2`; PR #2 remains Draft/Open. No remote migration, manual deployment, merge, or ready-for-review.

## Regression proven before correction

Phase 29 guarantees historical progress by carrying `history_due` and spending one rescue visit on history before the fresh tail on the next saturated/deadline-bound tick.

That visit was counted inside the same fixed 1,024-visit budget as the tail. Under sustained arrivals exactly at the nominal service boundary (1,024 fresh ranges/tick), the scheduler therefore alternated:

- tick without debt: 1,024 tail + 0 history;
- debt tick: 1,023 tail + 1 history.

Deterministic eight-tick result before correction:

`0,1,1,2,2,3,3,4` fresh-tail backlog.

The average tail service capacity under continuous saturation was therefore 1,023.5 ranges/tick, so a workload at the documented 1,024/tick boundary accumulated backlog indefinitely solely because of the fairness repayment.

At 1,100 arrivals/tick, phase 29 produced:

`76,153,229,306,382,459`.

This is one extra range of backlog on every debt tick compared with the phase-28 capacity slope.

## Correction

The cleanup now has a per-index `rescue_visit_limit`:

- normal tick: 1,024 total visits;
- `history_due` repayment tick: exactly one bounded additive visit, for a maximum of 1,025 total visits.

The forced historical visit still happens first. The tail then retains its full 1,024-visit nominal capacity. Ordinary historical review still consumes only whatever budget remains.

Corrected 1,024-arrival boundary over eight ticks:

`0,0,0,0,0,0,0,0`.

Corrected 1,100-arrival overload slope:

`76,152,228,304,380,456`.

At `pages_per_range=8` and 8 KiB blocks, the debt-tick coverage bound rises from 64 MiB to 64.0625 MiB per index: a single-range additive increase, not a second bulk lane.

## EXCEPTION/subtransaction overhead

Phase 29 isolates `lock_not_available` around each `brin_summarize_range` call. In PL/pgSQL, a block with an `EXCEPTION` clause forms a subtransaction, and PostgreSQL documents such blocks as significantly more expensive to enter/exit than blocks without `EXCEPTION`.

This phase did not fabricate a latency percentage for that overhead. A native PostgreSQL/PGlite benchmark of the phase-29-vs-phase-30 exception cost was not available in the execution environment, so no numeric CPU/WAL regression is claimed.

What is established structurally:

- if all 1,024 visits are fast, the current path can enter up to 1,024 per-range exception blocks (1,025 on a debt tick after this phase);
- the cooperative deadline remains 250 ms and is checked between calls;
- `lock_timeout` remains at most 100 ms for rescue work (or a stricter caller value);
- therefore fully blocked 100 ms lock attempts under the simple dense-contention model permit at most three attempts before the next deadline check observes expiry, with a modeled 300 ms elapsed time for those waits;
- this is not a hard runtime ceiling: a single `brin_summarize_range` that acquires its locks and then performs slow I/O can still overrun the cooperative deadline, as already documented in phase 27.

No additional production-code change was made for the exception overhead because a material operational regression was not quantified, while per-range `55P03` isolation is required to prevent one contended range from rolling back all rescue progress for that index.

## Validation

Executable deterministic model: `tools/audits/outbox-phase30.mjs`.

Contract: `src/lib/oneSignalDurableOutboxV2BrinRescueOperationalCost.contract.test.ts`.

The contract intentionally fails against the phase-29 source at the 1,024/tick boundary and passes after the additive fairness-visit correction. It also checks the 250 ms / 100 ms dense-lock bound model and retains per-range `lock_not_available` isolation without broad `WHEN OTHERS` swallowing.

Primary PostgreSQL references:

- https://www.postgresql.org/docs/17/plpgsql-control-structures.html
- https://www.postgresql.org/docs/17/plpgsql-structure.html
- https://www.postgresql.org/docs/17/runtime-config-client.html
