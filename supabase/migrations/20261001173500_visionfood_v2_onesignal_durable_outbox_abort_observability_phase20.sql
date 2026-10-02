-- OneSignal Durable Outbox V2 - phase 20.
--
-- Operational observability for transaction aborts (40001 / 40P01).
--
-- Proven gap before this migration:
--   * phase-10 health counted every cron failure together over 24h, so it could
--     not distinguish serialization/deadlock abort pressure from unrelated
--     failures or from a single transient abort that already recovered;
--   * runner success recency was not the same as durable outbox progress;
--   * backlog was a point-in-time snapshot without a conservative recent growth
--     signal.
--
-- This migration changes observability only. It does not catch, retry, delay,
-- or otherwise alter 40001/40P01 transaction semantics.
--
-- pg_cron job_run_details does not expose SQLSTATE as a separate column. For the
-- canonical runner, failed rows are classified from PostgreSQL's standard error
-- text in return_message. Exact SQLSTATE remains available in PostgreSQL logs.

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
  oldest_due_at timestamptz;
  oldest_sending_at timestamptz;
  oldest_due_seconds bigint:=0;
  oldest_sending_seconds bigint:=0;

  created_5m bigint:=0;
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

  select
    pg_catalog.count(*) filter (
      where o.status='pending'
        and o.available_at<=observed_at
    ),
    pg_catalog.count(*) filter (
      where o.status='retry'
        and o.available_at<=observed_at
    ),
    pg_catalog.count(*) filter (
      where o.status='sending'
    ),
    pg_catalog.count(*) filter (
      where o.status='sending'
        and o.lease_expires_at<=observed_at
    ),
    pg_catalog.count(*) filter (
      where o.status='failed'
        and o.failed_at>=observed_at-interval '24 hours'
    ),
    pg_catalog.min(o.available_at) filter (
      where o.status in ('pending','retry')
        and o.available_at<=observed_at
    ),
    pg_catalog.min(o.first_sending_at) filter (
      where o.status='sending'
    ),
    pg_catalog.count(*) filter (
      where o.created_at>=observed_at-interval '5 minutes'
    ),
    pg_catalog.count(*) filter (
      where (
        o.delivered_at>=observed_at-interval '5 minutes'
        or o.failed_at>=observed_at-interval '5 minutes'
      )
    ),
    pg_catalog.max(o.updated_at) filter (
      where o.attempt_count>0
        and o.status in ('sending','retry','delivered','failed')
    )
  into
    pending_due,
    retry_due,
    sending_count,
    expired_sending,
    failed_24h,
    oldest_due_at,
    oldest_sending_at,
    created_5m,
    terminal_5m,
    last_progress_at
  from private.onesignal_outbox o;

  select
    pg_catalog.count(*) filter (
      where x.created_at>=observed_at-interval '24 hours'
    ),
    pg_catalog.count(*) filter (
      where x.result_observed_at is null
    )
  into attempts_24h,unresolved_attempts
  from private.onesignal_outbox_attempts x;

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

  -- Do not call a short producer burst "growing backlog" by itself. Require a
  -- positive recent net flow plus a due backlog above one tick of dispatch
  -- capacity and an oldest due item already older than the runner delay budget.
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
    )
    select
      pg_catalog.max(coalesce(h.end_time,h.start_time)) filter (
        where h.status='succeeded'
      ),
      pg_catalog.count(*) filter (
        where h.start_time>=observed_at-interval '24 hours'
          and h.status not in ('succeeded','running')
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
        where h.start_time>=observed_at-interval '24 hours'
          and (h.is_40001 or h.is_40p01)
      )
      into
        runner_last_success_at,
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

    -- Bound the streak scan. 128 completed 15-second ticks cover >30 minutes,
    -- which is already well beyond the degradation threshold below.
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

    select
      pg_catalog.max(coalesce(d.end_time,d.start_time)) filter (
        where d.status='succeeded'
      ),
      pg_catalog.count(*) filter (
        where d.start_time>=observed_at-interval '24 hours'
          and d.status not in ('succeeded','running')
      )
      into cleanup_last_success_at,cleanup_failures_24h
    from cron.job_run_details d
    where d.jobid=cleanup_jobid;
  end if;

  runner_delayed:=
    not coalesce(runner_active,false)
    or runner_last_success_at is null
    or runner_last_success_at<observed_at-interval '90 seconds';

  cleanup_delayed:=
    not coalesce(cleanup_active,false)
    or cleanup_last_success_at is null
    or cleanup_last_success_at<observed_at-interval '30 minutes';

  -- A single recovered abort stays "transient". Escalate only when there is
  -- sustained abort pressure AND user-visible durable impact: progress stalled
  -- and due backlog is conservatively growing.
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
