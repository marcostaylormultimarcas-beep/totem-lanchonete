# Durable Outbox V2 — phase 33

Base: `bd3fa7d86093071609a327482e2b2028195a3b03`.

Scope: audit the capacity trade-off reintroduced by phase 32 after removing the unsafe deadline refund. No completed phase was re-audited. No remote migration, manual deployment, merge, or ready-for-review.

## Result

No material operational regression was proven. The runtime/migration remains unchanged.

Phase 32 intentionally restored the original 250 ms cooperative call-start deadline while keeping:

- normal visit cap: 1,024 ranges/index/tick;
- debt-tick cap: 1,025 total visits;
- one forced historical fairness visit when `history_due=true`;
- `lock_timeout <= 100 ms`;
- per-range `lock_not_available` isolation.

At the deliberately just-binding model value of 0.2442 ms/call, a debt tick performs 1 historical + 1,023 tail visits while a normal tick still performs 1,024 tail visits. Sustained 1,024 arrivals/tick therefore loses 1 tail range every two ticks.

## How narrow the phase-32 delta is

For the phase-32 removal to be the deciding factor, call time must fall between:

- full debt-tail threshold: `250 / 1024 = 0.244140625 ms`;
- full normal-tail threshold: `250 / 1023 = 0.2443792766 ms`.

Relative width: about `0.09775%`.

Below the lower threshold, the debt tick still admits all 1,024 tail calls without a refund.

Above the upper threshold, even a normal tick is deadline-bound below nominal 1,024 capacity; that is not a regression created by refund removal.

## Operational accumulation at the exact edge

The cleanup cadence is 10 minutes = 144 ticks/day.

At exactly 1,024 new ranges/tick for every tick:

- incremental loss: 0.5 range/tick;
- backlog after 24 h: 72 ranges;
- backlog after 7 d: 504 ranges;
- with `pages_per_range=8` and 8 KiB pages:
  - 24 h backlog coverage: 4.5 MiB of heap;
  - 7 d backlog coverage: 31.5 MiB of heap;
- sustaining 1,024 new ranges/tick itself implies about 9 GiB/day of heap growth per affected relation;
- incremental backlog fraction is about 0.04883% of that nominal range arrival rate.

It takes 2,048 uninterrupted just-binding ticks — about 14.22 days — for the incremental backlog to reach one nominal 1,024-range rescue budget.

Any small sub-capacity interval drains it. An alternating `[1024, 1023]` arrival pattern (average 1,023.5/tick) ends with zero incremental backlog in the deterministic model.

## Alternatives evaluated

### Per-call effective BRIN timeout

A local `statement_timeout` set from inside the cleanup function is not an effective per-call bound for the already-running client statement. PostgreSQL establishes the statement timeout from the value in force when the client command starts.

Therefore a real hard per-call timeout would require restructuring execution boundaries rather than adding a small `set_config` around `brin_summarize_range`.

That is a larger behavior change and was not justified by the measured phase-32 capacity delta.

### Separate retention/DELETE from BRIN rescue

Separating retention into its own transaction/cron statement would decouple retention commit from a slow BRIN call and would reduce the pre-existing cooperative-timeout coupling.

However, that is an architectural split of the cleanup lifecycle, scheduling, locking, observability, and failure semantics. Phase 33 did not find a material new backlog regression attributable to phase 32, so this split is not introduced.

## Validation artifacts

- `src/lib/oneSignalDurableOutboxV2BrinRescueJustBindingBacklog.contract.test.ts`
- `tools/audits/outbox-phase33.mjs`

The audit proves:

1. the phase-32 runtime remains unchanged;
2. the incremental just-binding band is under 0.1% wide;
3. exact 1,024/tick growth is 72 ranges/day;
4. 0.5 range/tick of average headroom clears the incremental backlog;
5. no functional correction is warranted from this audit alone.

No remote migration was applied.
