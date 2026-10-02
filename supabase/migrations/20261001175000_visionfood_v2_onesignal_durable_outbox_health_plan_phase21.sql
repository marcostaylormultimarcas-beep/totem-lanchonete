-- OneSignal Durable Outbox V2 - phase 21.
--
-- Bound the execution cost of the phase-20 health snapshot under large outbox
-- backlog and retained pg_cron history.
--
-- Failure proven before this migration:
--   * phase-20 health aggregated the complete onesignal_outbox relation once,
--     even when most rows were old terminal history unrelated to the short
--     diagnostic windows;
--   * it aggregated the complete attempts relation once for two independent
--     predicates;
--   * runner/cleanup history aggregates started from every retained row for a
--     job, while pg_cron's stock job_run_details schema only guarantees the
--     runid primary key;
--   * therefore observability work scaled with retained history and could
--     compete for buffer/CPU with the runner and cleanup it was measuring.
--
-- This migration changes observability access paths only. It does not change
-- claim, fairness, cursor, lease, retry, payload, audience, generation,
-- idempotency, pg_net transport, or transaction-abort semantics.
--
-- This migration remains local to the branch until explicitly approved.

-- pg_cron does not provide a jobid/start_time access path by default. Health
-- repeatedly asks for newest rows and bounded windows for one job.
do language plpgsql '
begin
  begin
    execute ''create index if not exists visionfood_onesignal_cron_history_job_start_idx on cron.job_run_details(jobid,start_time desc,runid desc)'';
  exception
    when insufficient_privilege then
      raise notice ''Skipping cron.job_run_details health index: managed pg_cron table is owned by supabase_admin'';
  end;
end
';

-- Existing claim/lease indexes already cover due pending/retry and sending
-- subsets. Retention eventually creates reusable old heap pages, so plain
-- minmax with a wide page range can lose physical created_at correlation:
-- one recent tuple reused into an old range makes the whole range lossy.
-- Keep BRIN's low per-row write footprint, but use minmax-multi to preserve
-- gaps between old/new timestamp clusters and an 8-page range to cap heap
-- rechecks when recent rows are sparsely scattered by page reuse.
create index if not exists onesignal_outbox_health_created_idx
  on private.onesignal_outbox
  using brin(created_at timestamptz_minmax_multi_ops(values_per_range=64))
  with (pages_per_range=8,autosummarize=on);

create index if not exists onesignal_outbox_health_failed_idx
  on private.onesignal_outbox(failed_at desc)
  where status='failed'
    and failed_at is not null;

create index if not exists onesignal_outbox_health_delivered_idx
  on private.onesignal_outbox(delivered_at desc)
  where status='delivered'
    and delivered_at is not null;

-- updated_at changes in claim, dispatch persistence and reconcile, so indexing
-- it would turn observability into write amplification on the hottest row path.
-- last_attempt_at advances once per claim attempt and is otherwise stable.
create index if not exists onesignal_outbox_health_attempted_idx
  on private.onesignal_outbox(last_attempt_at desc)
  where last_attempt_at is not null;

-- Attempts are append-correlated at first, but ON DELETE CASCADE from retained
-- outbox rows also creates reusable old heap pages. Use the same minmax-multi
-- + small-range policy so the 24h health window does not degenerate toward a
-- broad lossy scan after sustained delete/reuse cycles.
create index if not exists onesignal_outbox_attempts_health_created_idx
  on private.onesignal_outbox_attempts
  using brin(created_at timestamptz_minmax_multi_ops(values_per_range=64))
  with (pages_per_range=8,autosummarize=on);

-- Do not add a second unresolved-attempt index. Phase 3 already owns
-- onesignal_outbox_attempts_unresolved_idx(submitted_at,id) for the exact
-- runtime unresolved subset (result_observed_at IS NULL + request id present).

create or replace function private.visionfood_onesignal_outbox_health()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  observed_at timestamptz:=pg_catalog.clock_timestamp();

  pending_due bigint:=0;
  retry_due bigint:=0;
  sending_count bigint:=0;
  expired_sending bigint:=0;
  failed_24h bigint:=0;
  attempts_24h bigint:=0;
  unresolved_attempts bigint:=0;
  pending_oldest_at timestamptz;
  retry_oldest_at timestamptz;
  oldest_due_at timestamptz;
  oldest_sending_at timestamptz;
  oldest_due_seconds bigint:=0;
  oldest_sending_seconds bigint:=0;

  created_5m bigint:=0;
  delivered_5m bigint:=0;
  terminal_failed_5m bigint:=0;
  terminal_5m bigint:=0;
  net_growth_5m bigint:=0;
  backlog_growing boolean:=false;

  last_progress_at timestamptz;
  progress_lag_seconds bigint;
  progress_stalled boolean:=false;

  runner_jobid bigint;
  runner_active boolean:=false;
  runner_last_status text;
  runner_last_started_at timestamptz;
  runner_last_ended_at timestamptz;
  runner_last_success_at timestamptz;
  runner_failures_24h bigint:=0;
  runner_runs_5m bigint:=0;
  serialization_aborts_5m bigint:=0;
  deadlock_aborts_5m bigint:=0;
  transaction_aborts_24h bigint:=0;
  transaction_aborts_5m bigint:=0;
  transaction_abort_rate_5m numeric:=0;
  consecutive_transaction_aborts bigint:=0;
  transaction_abort_state text:='none';

  cleanup_jobid bigint;
  cleanup_active boolean:=false;
  cleanup_last_status text;
  cleanup_last_started_at timestamptz;
  cleanup_last_ended_at timestamptz;
  cleanup_last_success_at timestamptz;
  cleanup_failures_24h bigint:=0;

  runner_delayed boolean:=true;
  cleanup_delayed boolean:=true;

  dispatch_batch_limit integer:=100;
  dispatch_max_rounds integer:=5;
  dispatch_capacity_per_tick integer:=500;
  reconcile_batch_limit integer:=500;
begin
  dispatch_capacity_per_tick:=dispatch_batch_limit*dispatch_max_rounds;

  -- Keep exact due counts, but make them walk only the due-status partial
  -- indexes instead of every terminal row in the retained outbox relation.
  select pg_catalog.count(*),pg_catalog.min(o.available_at)
    into pending_due,pending_oldest_at
  from private.onesignal_outbox o
  where o.status='pending'
    and o.available_at<=observed_at;

  select pg_catalog.count(*),pg_catalog.min(o.available_at)
    into retry_due,retry_oldest_at
  from private.onesignal_outbox o
  where o.status='retry'
    and o.available_at<=observed_at;

  oldest_due_at:=case
    when pending_oldest_at is null then retry_oldest_at
    when retry_oldest_at is null then pending_oldest_at
    else least(pending_oldest_at,retry_oldest_at)
  end;

  -- Sending rows are already isolated by the partial lease index created in
  -- the base migration; scanning this active subset does not walk terminal
  -- history.
  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (
      where o.lease_expires_at<=observed_at
    ),
    pg_catalog.min(o.first_sending_at)
    into sending_count,expired_sending,oldest_sending_at
  from private.onesignal_outbox o
  where o.status='sending';

  select pg_catalog.count(*)
    into failed_24h
  from private.onesignal_outbox o
  where o.status='failed'
    and o.failed_at>=observed_at-interval '24 hours';

  select pg_catalog.count(*)
    into created_5m
  from private.onesignal_outbox o
  where o.created_at>=observed_at-interval '5 minutes';

  select pg_catalog.count(*)
    into delivered_5m
  from private.onesignal_outbox o
  where o.status='delivered'
    and o.delivered_at>=observed_at-interval '5 minutes';

  select pg_catalog.count(*)
    into terminal_failed_5m
  from private.onesignal_outbox o
  where o.status='failed'
    and o.failed_at>=observed_at-interval '5 minutes';

  terminal_5m:=delivered_5m+terminal_failed_5m;

  -- Durable progress is the newest attempt start or terminal observation.
  -- This preserves the phase-20 stall signal while avoiding an index on
  -- updated_at, which is rewritten multiple times per attempt lifecycle.
  select greatest(
    (
      select pg_catalog.max(o.last_attempt_at)
      from private.onesignal_outbox o
      where o.last_attempt_at is not null
    ),
    (
      select pg_catalog.max(o.delivered_at)
      from private.onesignal_outbox o
      where o.status='delivered'
        and o.delivered_at is not null
    ),
    (
      select pg_catalog.max(o.failed_at)
      from private.onesignal_outbox o
      where o.status='failed'
        and o.failed_at is not null
    )
  )
    into last_progress_at;

  -- Separate recent-attempt volume from unresolved-attempt pressure so each
  -- predicate can use its own narrow access path.
  select pg_catalog.count(*)
    into attempts_24h
  from private.onesignal_outbox_attempts x
  where x.created_at>=observed_at-interval '24 hours';

  select pg_catalog.count(*)
    into unresolved_attempts
  from private.onesignal_outbox_attempts x
  where x.result_observed_at is null
    and x.pg_net_request_id is not null;

  oldest_due_seconds:=coalesce(
    greatest(
      0,
      extract(epoch from observed_at-oldest_due_at)::bigint
    ),
    0
  );

  oldest_sending_seconds:=coalesce(
    greatest(
      0,
      extract(epoch from observed_at-oldest_sending_at)::bigint
    ),
    0
  );

  if last_progress_at is not null then
    progress_lag_seconds:=greatest(
      0,
      extract(epoch from observed_at-last_progress_at)::bigint
    );
  else
    progress_lag_seconds:=null;
  end if;

  progress_stalled:=
    pending_due+retry_due>0
    and (
      last_progress_at is null
      or last_progress_at<observed_at-interval '90 seconds'
    );

  net_growth_5m:=created_5m-terminal_5m;

  backlog_growing:=
    net_growth_5m>0
    and pending_due+retry_due>dispatch_capacity_per_tick
    and oldest_due_seconds>=90;

  select j.jobid,j.active
    into runner_jobid,runner_active
  from cron.job j
  where j.jobname='visionfood-onesignal-outbox-v2'
  order by j.jobid desc
  limit 1;

  if runner_jobid is not null then
    select d.status,d.start_time,d.end_time
      into runner_last_status,runner_last_started_at,runner_last_ended_at
    from cron.job_run_details d
    where d.jobid=runner_jobid
    order by d.start_time desc nulls last,d.runid desc
    limit 1;

    -- Preserve "last successful runner" semantics without aggregating every
    -- retained row for the job.
    select coalesce(d.end_time,d.start_time)
      into runner_last_success_at
    from cron.job_run_details d
    where d.jobid=runner_jobid
      and d.status='succeeded'
    order by d.start_time desc nulls last,d.runid desc
    limit 1;

    -- All remaining aggregate metrics are defined over <=24h, so push that
    -- bound into the base relation before classifying return_message.
    with runner_history as (
      select
        d.runid,
        d.status,
        d.return_message,
        d.start_time,
        d.end_time,
        (
          d.status not in ('succeeded','running')
          and (
            position(
              'could not serialize access'
              in pg_catalog.lower(coalesce(d.return_message,''))
            )>0
            or position(
              'serialization failure'
              in pg_catalog.lower(coalesce(d.return_message,''))
            )>0
            or position(
              'sqlstate 40001'
              in pg_catalog.lower(coalesce(d.return_message,''))
            )>0
          )
        ) as is_40001,
        (
          d.status not in ('succeeded','running')
          and (
            position(
              'deadlock detected'
              in pg_catalog.lower(coalesce(d.return_message,''))
            )>0
            or position(
              'sqlstate 40p01'
              in pg_catalog.lower(coalesce(d.return_message,''))
            )>0
          )
        ) as is_40p01
      from cron.job_run_details d
      where d.jobid=runner_jobid
        and d.start_time>=observed_at-interval '24 hours'
    )
    select
      pg_catalog.count(*) filter (
        where h.status not in ('succeeded','running')
      ),
      pg_catalog.count(*) filter (
        where h.start_time>=observed_at-interval '5 minutes'
          and h.status<>'running'
      ),
      pg_catalog.count(*) filter (
        where h.start_time>=observed_at-interval '5 minutes'
          and h.is_40001
      ),
      pg_catalog.count(*) filter (
        where h.start_time>=observed_at-interval '5 minutes'
          and h.is_40p01
      ),
      pg_catalog.count(*) filter (
        where h.is_40001 or h.is_40p01
      )
      into
        runner_failures_24h,
        runner_runs_5m,
        serialization_aborts_5m,
        deadlock_aborts_5m,
        transaction_aborts_24h
    from runner_history h;

    transaction_aborts_5m:=
      serialization_aborts_5m+deadlock_aborts_5m;

    transaction_abort_rate_5m:=coalesce(
      transaction_aborts_5m::numeric
      /nullif(runner_runs_5m,0),
      0
    );

    -- The streak remains hard-bounded to 128 completed ticks. The new
    -- (jobid,start_time,runid) index makes this a newest-first prefix lookup.
    with latest_completed as (
      select
        d.runid,
        d.start_time,
        (
          d.status not in ('succeeded','running')
          and (
            position(
              'could not serialize access'
              in pg_catalog.lower(coalesce(d.return_message,''))
            )>0
            or position(
              'serialization failure'
              in pg_catalog.lower(coalesce(d.return_message,''))
            )>0
            or position(
              'sqlstate 40001'
              in pg_catalog.lower(coalesce(d.return_message,''))
            )>0
            or position(
              'deadlock detected'
              in pg_catalog.lower(coalesce(d.return_message,''))
            )>0
            or position(
              'sqlstate 40p01'
              in pg_catalog.lower(coalesce(d.return_message,''))
            )>0
          )
        ) as is_transaction_abort
      from cron.job_run_details d
      where d.jobid=runner_jobid
        and d.status<>'running'
      order by d.start_time desc nulls last,d.runid desc
      limit 128
    ),
    streak as (
      select
        c.*,
        pg_catalog.sum(
          case when c.is_transaction_abort then 0 else 1 end
        ) over (
          order by c.start_time desc nulls last,c.runid desc
          rows between unbounded preceding and current row
        ) as non_abort_seen
      from latest_completed c
    )
    select pg_catalog.count(*)
      into consecutive_transaction_aborts
    from streak s
    where s.is_transaction_abort
      and s.non_abort_seen=0;
  end if;

  select j.jobid,j.active
    into cleanup_jobid,cleanup_active
  from cron.job j
  where j.jobname='visionfood-onesignal-outbox-v2-cleanup'
  order by j.jobid desc
  limit 1;

  if cleanup_jobid is not null then
    select d.status,d.start_time,d.end_time
      into cleanup_last_status,cleanup_last_started_at,cleanup_last_ended_at
    from cron.job_run_details d
    where d.jobid=cleanup_jobid
    order by d.start_time desc nulls last,d.runid desc
    limit 1;

    select coalesce(d.end_time,d.start_time)
      into cleanup_last_success_at
    from cron.job_run_details d
    where d.jobid=cleanup_jobid
      and d.status='succeeded'
    order by d.start_time desc nulls last,d.runid desc
    limit 1;

    select pg_catalog.count(*)
      into cleanup_failures_24h
    from cron.job_run_details d
    where d.jobid=cleanup_jobid
      and d.start_time>=observed_at-interval '24 hours'
      and d.status not in ('succeeded','running');
  end if;

  runner_delayed:=
    not coalesce(runner_active,false)
    or runner_last_success_at is null
    or runner_last_success_at<observed_at-interval '90 seconds';

  cleanup_delayed:=
    not coalesce(cleanup_active,false)
    or cleanup_last_success_at is null
    or cleanup_last_success_at<observed_at-interval '30 minutes';

  if transaction_aborts_5m>=3
     and consecutive_transaction_aborts>=3
     and transaction_abort_rate_5m>=0.20
     and progress_stalled
     and backlog_growing then
    transaction_abort_state:='degraded';
  elsif transaction_aborts_24h>0 then
    transaction_abort_state:='transient';
  else
    transaction_abort_state:='none';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'observed_at',observed_at,
    'backlog',pg_catalog.jsonb_build_object(
      'pending_due',pending_due,
      'retry_due',retry_due,
      'sending',sending_count,
      'expired_sending',expired_sending,
      'failed_24h',failed_24h,
      'attempts_24h',attempts_24h,
      'unresolved_attempts',unresolved_attempts,
      'oldest_due_seconds',oldest_due_seconds,
      'oldest_sending_seconds',oldest_sending_seconds,
      'created_5m',created_5m,
      'terminal_5m',terminal_5m,
      'net_growth_5m',net_growth_5m,
      'backlog_growing',backlog_growing
    ),
    'capacity',pg_catalog.jsonb_build_object(
      'reconcile_batch_limit',reconcile_batch_limit,
      'dispatch_batch_limit',dispatch_batch_limit,
      'dispatch_max_rounds',dispatch_max_rounds,
      'dispatch_capacity_per_tick',dispatch_capacity_per_tick,
      'dispatch_saturated',
        pending_due+retry_due>dispatch_capacity_per_tick,
      'reconcile_saturated',
        unresolved_attempts>reconcile_batch_limit
    ),
    'runner',pg_catalog.jsonb_build_object(
      'active',coalesce(runner_active,false),
      'last_status',runner_last_status,
      'last_started_at',runner_last_started_at,
      'last_ended_at',runner_last_ended_at,
      'last_success_at',runner_last_success_at,
      'failures_24h',runner_failures_24h,
      'runner_delayed',runner_delayed,
      'runs_5m',runner_runs_5m,
      'serialization_aborts_5m',serialization_aborts_5m,
      'deadlock_aborts_5m',deadlock_aborts_5m,
      'transaction_aborts_24h',transaction_aborts_24h,
      'transaction_abort_rate_5m',transaction_abort_rate_5m,
      'consecutive_transaction_aborts',consecutive_transaction_aborts,
      'last_progress_at',last_progress_at,
      'progress_lag_seconds',progress_lag_seconds,
      'progress_stalled',progress_stalled,
      'transaction_abort_state',transaction_abort_state
    ),
    'cleanup',pg_catalog.jsonb_build_object(
      'active',coalesce(cleanup_active,false),
      'last_status',cleanup_last_status,
      'last_started_at',cleanup_last_started_at,
      'last_ended_at',cleanup_last_ended_at,
      'last_success_at',cleanup_last_success_at,
      'failures_24h',cleanup_failures_24h,
      'cleanup_delayed',cleanup_delayed
    )
  );
end
$$;

revoke all on function private.visionfood_onesignal_outbox_health()
  from public,anon,authenticated;
grant execute on function private.visionfood_onesignal_outbox_health()
  to service_role;
