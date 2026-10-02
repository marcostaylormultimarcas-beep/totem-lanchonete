-- OneSignal Durable Outbox V2 - phase 8.
--
-- Operational liveness after full cutover. The durable outbox must make
-- progress even when no new predictive/delivery/rupture producer event occurs.
--
-- pg_cron is only the wake-up mechanism. The durable source of truth remains
-- private.onesignal_outbox / private.onesignal_outbox_attempts, and pg_net
-- remains only the asynchronous HTTP transport.

create extension if not exists pg_cron;

create or replace function private.visionfood_onesignal_outbox_run_once(
  _reconcile_batch_limit integer default 500,
  _dispatch_batch_limit integer default 100,
  _lease_seconds integer default 30,
  _retry_delay_seconds integer default 15,
  _max_attempts integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  runner_lock bigint:=pg_catalog.hashtextextended(
    'visionfood:onesignal_outbox_v2_runner',
    0
  );
  reconciled_count integer:=0;
  dispatched_count integer:=0;
begin
  -- Serialize cron/manual runners without waiting. If a previous tick is still
  -- active, the next scheduled tick will retry; no producer event is required.
  if not pg_catalog.pg_try_advisory_xact_lock(runner_lock) then
    return pg_catalog.jsonb_build_object(
      'ok',true,
      'busy',true,
      'reconciled',0,
      'dispatched',0
    );
  end if;

  -- First fold any pg_net response into durable state and recover expired
  -- sending leases. Missing responses after lease expiry become retry rows.
  select pg_catalog.count(*)
    into reconciled_count
  from private.visionfood_onesignal_outbox_reconcile(
    greatest(1,least(coalesce(_reconcile_batch_limit,500),500)),
    greatest(1,least(coalesce(_retry_delay_seconds,15),3600)),
    greatest(1,least(coalesce(_max_attempts,8),100))
  );

  -- Then claim/dispatch every pending or retry row whose available_at is due.
  -- Rows just moved to retry by the reconcile step keep their retry delay and
  -- will be picked up by a later periodic tick, preserving backoff semantics.
  select pg_catalog.count(*)
    into dispatched_count
  from private.visionfood_onesignal_outbox_dispatch(
    'cron-outbox-v2:'||pg_catalog.pg_backend_pid()::text,
    greatest(1,least(coalesce(_dispatch_batch_limit,100),100)),
    greatest(5,least(coalesce(_lease_seconds,30),300)),
    greatest(1,least(coalesce(_retry_delay_seconds,15),3600)),
    greatest(1,least(coalesce(_max_attempts,8),100))
  );

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'busy',false,
    'reconciled',reconciled_count,
    'dispatched',dispatched_count
  );
end
$$;

revoke all on function private.visionfood_onesignal_outbox_run_once(integer,integer,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function private.visionfood_onesignal_outbox_run_once(integer,integer,integer,integer,integer)
  to service_role;

-- Idempotently install one persistent DB-side wake-up. pg_cron survives
-- application restarts and does not depend on any future producer transaction.
do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname='visionfood-onesignal-outbox-v2'
  ) then
    perform cron.unschedule('visionfood-onesignal-outbox-v2');
  end if;

  perform cron.schedule(
    'visionfood-onesignal-outbox-v2',
    '15 seconds',
    $cron$
      select private.visionfood_onesignal_outbox_run_once();
    $cron$
  );
end
$$;
