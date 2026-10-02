# Durable Outbox V2 — phase 32

Base: `0c4634d891163538e5a4170401831b80d0b110b4`.
Regression proof commit: `a5c89c2601821fe1fd9fb1b93a50c8a879ca496c`.
Correction commit: `e1848c886121f8a2dca6f6a0ff1111cf8cba69ee`.
Audit-model commit: `5f2207e122dc584cff4f70db22b9246a7d28ce6f`.
Branch: `fix/verification-round-2`; PR #2 remains Draft/Open. No remote migration, manual deployment, merge, or ready-for-review.

## Regression proven before correction

Phase 31 refunded up to 100 ms of the forced `history_due` BRIN call by extending the per-index cooperative deadline beyond the original 250 ms.

The refund itself was numerically small, but it changed **call admission**: after a historical call returned after the original 250 ms boundary, the extended deadline could still authorize a new `brin_summarize_range` call.

`lock_timeout` protects lock acquisition waits, not slow I/O after a lock has already been acquired. Therefore the newly admitted call did not inherit the nominal 100 ms refund bound.

Deterministic reproduction used:

- original cooperative deadline: 250 ms;
- phase-31 refund cap: 100 ms;
- forced historical call: 300 ms after successful lock acquisition;
- refund-only tail call: 300,000 ms of post-lock I/O;
- `history_due=true` on both BRIN indexes.

Without the phase-31 refund, each index stops after the 300 ms historical call because the original 250 ms deadline has already expired. Two indexes therefore model 600 ms total.

With the refund, each index extends its call-start deadline to 350 ms. At 300 ms the cleanup starts one tail summarize call that phase 30 would not have started. Two indexes therefore model:

`300,300 ms + 300,300 ms = 600,600 ms`.

The cleanup cron interval is 600,000 ms (10 minutes), so the phase-31 mechanism can push one cleanup execution beyond the next scheduled tick even though the refund itself is only 100 ms/index.

The cleanup-level advisory transaction lock prevents two cleanup bodies from running concurrently. The operational failure mode is instead that the next cron invocation observes the lock as busy and skips its retention pass while the previous transaction is still waiting to commit.

Retention/DELETE executes before BRIN rescue in the same transaction. A long refund-enabled rescue therefore also delays commit of the retention work already performed by that invocation.

## Correction

Phase 32 removes only the **time refund**.

Preserved:

- 250 ms cooperative BRIN call-start deadline;
- 100 ms maximum `lock_timeout` (or a stricter caller value);
- phase-30 additive `history_due` visit budget;
- normal tick limit: 1,024 visits;
- debt tick limit: at most 1,025 visits;
- historical fairness cursor and `history_due` state;
- per-index `lock_not_available` isolation.

Removed:

- `rescue_history_started_at`;
- `rescue_deadline := rescue_deadline + least(..., 100 ms)`.

This means phase 32 no longer creates a post-250 ms call-start window whose next BRIN call could overrun arbitrarily on post-lock I/O.

## Deliberate capacity trade-off

Removing the time refund restores the phase-30 deadline behavior at the deliberately just-binding 0.2442 ms/call model.

At sustained 1,024 fresh ranges/tick, eight-tick backlog is again:

`0,1,1,2,2,3,3,4`.

That trade-off is intentional. The phase-30 additive 1,025 **visit** cap remains, but the cleanup no longer spends extra wall-clock admission budget to guarantee all 1,024 fresh-tail visits when the 250 ms deadline is exactly binding.

The alternative would require a hard per-call execution timeout that also covers post-lock I/O, or a larger architectural split between retention and BRIN rescue. Neither is introduced in this phase.

## Validation

Regression contract:

`src/lib/oneSignalDurableOutboxV2BrinRescueRefundIoOverlap.contract.test.ts`

Updated deadline contract:

`src/lib/oneSignalDurableOutboxV2BrinRescueDeadlineCapacity.contract.test.ts`

Executable deterministic model:

`tools/audits/outbox-phase32.mjs`

The model proves:

- phase 31: two simultaneous debt indexes can reach 600,600 ms in the deterministic refund-only slow-I/O scenario;
- phase 32: the same scenario performs no refund-only tail calls and returns to 600 ms;
- the 1,025 debt-tick visit ceiling remains preserved;
- the just-binding 1,024/tick capacity trade-off is explicit rather than hidden.

No remote migration was applied.
