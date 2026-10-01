# Durable Outbox V2 — phase 28

Base: `9fc43679b686a08f2a566b5db298ccf46c064a20`.
Regression proof commit: `b5742c81ab8375d41a3321331e6c58566f25f8c4`.
Correction commit: `60cbe218f696590e021a12d131f0a4cfb72a6204`.
Contract strengthening: `9a5c2ee76dec0de8b85bb30db8fcaac8fbc3a120`.
Branch: `fix/verification-round-2`; PR #2 remains open/draft. No remote migration, manual deploy, merge, or ready-for-review.

## Regression proven

Phase 27 bounded the BRIN rescue to at most 1,024 range visits per index and persisted a single sequential cursor. That bound prevents cleanup from draining an arbitrary unsummarized backlog, but a single historical cursor is not fair to new EOF ranges.

Deterministic scheduler reproduction with 3,000 already summarized historical ranges and 100 new unsummarized ranges appended per cleanup tick:

- tick 1: 1,024 historical visits, backlog 100;
- tick 2: 1,024 historical visits, backlog 200;
- tick 3: 952 historical + 72 fresh summaries, backlog 228;
- tick 4: remaining 328 fresh summaries, backlog 0, cursor wraps;
- ticks 5–6 repeat historical-only work and backlog regrows to 100 then 200.

So the system can repeatedly spend whole rescue budgets on an already summarized prefix while fresh ranges accumulate, even when the sustained arrival rate (100/tick) is far below the nominal 1,024-range service capacity.

## Correction

The unapplied phase-10 migration now keeps two per-index positions:

- `tail_page`: first BRIN range in the fresh-tail priority lane;
- `next_page`: historical review cursor.

Each cleanup tick:

1. Initializes a missing/recreated tail cursor to the newest window of at most 1,024 BRIN ranges, so an existing unsummarized EOF burst is not hidden behind a large prefix.
2. Visits the fresh tail first, advancing `tail_page` across ticks when the burst itself exceeds capacity.
3. Uses only the remaining visit/time budget to advance `next_page` through the historical prefix.
4. Keeps the existing 1,024-visit/index cap, 250 ms cooperative deadline, 100 ms maintenance lock bound, transaction-local cursor atomicity, and lock-skip subtransaction behavior from phase 27.
5. Resets safely on index recreation or relation shrink/truncate.

No foreground runner/health/enqueue/claim semantics changed.

## Capacity and backlog results

With 100 new ranges/tick behind a 3,000-range summarized prefix, six corrected ticks summarize all 100 new ranges each time and backlog remains `0,0,0,0,0,0`. Spare capacity revisits 924 historical ranges on most ticks (528 on the wrap tick).

With 1,100 new ranges/tick, the fixed 1,024-visit cap remains authoritative. Backlog grows by 76/tick: `76,152,228,304,380,456`. When arrivals stop, the next tick spends 456 visits draining the tail and the remaining 568 visits on history, returning backlog to zero. This is expected overload behavior, not hidden starvation.

## Evidence limits

`tools/audits/outbox-phase28.mjs` is a deterministic scheduler model for the cursor policy. It does not claim PostgreSQL I/O latency, pg_cron overlap, or BRIN internal timing. Phase 27 already exercised the real `brin_summarize_range` path in PostgreSQL 17.5/PGlite; phase 28 changes which range starts are selected under the same bounded calls.

Raw model output is preserved in `before.jsonl` and `after.jsonl`.
