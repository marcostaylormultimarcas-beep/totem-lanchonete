-- OneSignal Durable Outbox V2 - phase 10.
--
-- Operational observability and bounded backpressure handling for the phase-8
-- runner and phase-9 retention cleanup.
--
-- Proven gaps before this migration:
--   * old unresolved late-response attempts could repeatedly occupy the oldest
--     reconcile batch and starve newer observable responses;
--   * the 15s runner drained only one 100-row dispatch batch per tick;
--   * there was no single health snapshot for due backlog, expired leases,
--     failed/attempt growth, or delayed/failed cron jobs;
--   * pg_cron run history for the 15s job was unbounded.
--
-- This migration remains local to the branch until explicitly approved.

create extension if not exists pg_cron;

create or replace function private.visionfood_onesignal_outbox_reconcile(
  _batch_limit integer default 100,
  _retry_delay_seconds integer default 15,
  _max_attempts integer default 8
)
returns table(
  reconciled_outbox_id uuid,
  reconciled_attempt_no integer,
  reconcile_state text
)
language plpgsql
security definer
set search_path=''
as $$
declare
  a record;
  o record;
  request_matches bigint;
  response_matches bigint;
  response_status integer;
  response_timed_out boolean;
  response_error text;
  response_body text;
  response_payload jsonb;
  notification_id text;
  retryable boolean;
  failure_reason text;
  retry_state text;
  batch_size integer:=greatest(1,least(coalesce(_batch_limit,100),500));
begin
  for a in
    select
      x.*,
      case
        when exists (
          select 1
          from net._http_response r
          where r.id=x.pg_net_request_id
            and r.created>=coalesce(x.submitted_at,x.created_at)
        ) then 0
        else 1
      end as response_priority,
      case
        when exists (
          select 1
          from private.onesignal_outbox current_o
          where current_o.id=x.outbox_id
            and current_o.status='sending'
            and current_o.attempt_count=x.attempt_no
            and current_o.lease_token=x.lease_token
            and current_o.lease_expires_at<=pg_catalog.clock_timestamp()
        ) then 0
        else 1
      end as lease_priority
    from private.onesignal_outbox_attempts x
    where x.result_observed_at is null
      and x.pg_net_request_id is not null
    order by response_priority,lease_priority,x.submitted_at,x.id
    for update of x skip locked
    limit batch_size
  loop
    select count(*)
      into request_matches
    from private.onesignal_outbox_attempts x
    where x.pg_net_request_id=a.pg_net_request_id;

    if request_matches<>1 then
      update private.onesignal_outbox_attempts x
         set result_observed_at=pg_catalog.clock_timestamp(),
             error_text='transport_request_id_ambiguous',
             semantic_outcome='retry'
       where x.id=a.id;

      select o2.status,o2.attempt_count,o2.lease_token,o2.lease_expires_at
        into o
      from private.onesignal_outbox o2
      where o2.id=a.outbox_id;

      if found
         and o.status='sending'
         and o.attempt_count=a.attempt_no
         and o.lease_token=a.lease_token then
        retry_state:=private.visionfood_onesignal_outbox_retry(
          a.outbox_id,
          a.attempt_no,
          a.lease_token,
          'transport_request_id_ambiguous',
          _retry_delay_seconds,
          _max_attempts
        );
      else
        retry_state:='stale';
      end if;

      return query select a.outbox_id,a.attempt_no,coalesce(retry_state,'stale');
      continue;
    end if;

    select count(*)
      into response_matches
    from net._http_response r
    where r.id=a.pg_net_request_id
      and r.created>=coalesce(a.submitted_at,a.created_at);

    if response_matches=0 then
      select o2.status,o2.attempt_count,o2.lease_token,o2.lease_expires_at
        into o
      from private.onesignal_outbox o2
      where o2.id=a.outbox_id;

      if found
         and o.status='sending'
         and o.attempt_count=a.attempt_no
         and o.lease_token=a.lease_token
         and o.lease_expires_at<=pg_catalog.clock_timestamp() then
        retry_state:=private.visionfood_onesignal_outbox_retry(
          a.outbox_id,
          a.attempt_no,
          a.lease_token,
          'response_missing',
          _retry_delay_seconds,
          _max_attempts
        );

        return query select
          a.outbox_id,
          a.attempt_no,
          coalesce(retry_state,'stale');
      else
        return query select a.outbox_id,a.attempt_no,'waiting'::text;
      end if;

      -- Keep attempt.result_observed_at NULL. A late OneSignal success from this
      -- exact transport attempt may still appear and must be able to promote the
      -- logical outbox to delivered after a retry has already started.
      continue;
    end if;

    if response_matches<>1 then
      update private.onesignal_outbox_attempts x
         set result_observed_at=pg_catalog.clock_timestamp(),
             error_text='transport_response_ambiguous',
             semantic_outcome='retry'
       where x.id=a.id;

      select o2.status,o2.attempt_count,o2.lease_token,o2.lease_expires_at
        into o
      from private.onesignal_outbox o2
      where o2.id=a.outbox_id;

      if found
         and o.status='sending'
         and o.attempt_count=a.attempt_no
         and o.lease_token=a.lease_token then
        retry_state:=private.visionfood_onesignal_outbox_retry(
          a.outbox_id,
          a.attempt_no,
          a.lease_token,
          'transport_response_ambiguous',
          _retry_delay_seconds,
          _max_attempts
        );
      else
        retry_state:='stale';
      end if;

      return query select a.outbox_id,a.attempt_no,coalesce(retry_state,'stale');
      continue;
    end if;

    select r.status_code,r.timed_out,r.error_msg,r.content
      into response_status,response_timed_out,response_error,response_body
    from net._http_response r
    where r.id=a.pg_net_request_id
      and r.created>=coalesce(a.submitted_at,a.created_at)
    order by r.created desc
    limit 1;

    response_payload:=null;
    notification_id:=null;

    if response_status>=200
       and response_status<300
       and not coalesce(response_timed_out,false)
       and nullif(btrim(coalesce(response_error,'')),'') is null then
      begin
        response_payload:=response_body::jsonb;
      exception
        when others then
          response_payload:=null;
      end;

      notification_id:=nullif(
        btrim(coalesce(response_payload->>'id','')),
        ''
      );
    end if;

    if notification_id is not null then
      update private.onesignal_outbox_attempts x
         set result_observed_at=pg_catalog.clock_timestamp(),
             http_status=response_status,
             timed_out=coalesce(response_timed_out,false),
             error_text=response_error,
             response_body=response_body,
             semantic_outcome='delivered',
             onesignal_notification_id=notification_id
       where x.id=a.id;

      -- Semantic success is monotonic and wins even when it arrives from an old
      -- attempt after a newer retry or after a terminal failure decision.
      update private.onesignal_outbox outbox
         set status='delivered',
             lease_token=null,
             lease_owner=null,
             lease_expires_at=null,
             last_request_id=a.pg_net_request_id,
             last_http_status=response_status,
             last_error=null,
             last_response_body=response_body,
             onesignal_notification_id=notification_id,
             delivered_at=coalesce(
               outbox.delivered_at,
               pg_catalog.clock_timestamp()
             ),
             failed_at=null,
             updated_at=pg_catalog.clock_timestamp()
       where outbox.id=a.outbox_id
         and outbox.status<>'delivered';

      return query select a.outbox_id,a.attempt_no,'delivered'::text;
      continue;
    end if;

    retryable:=
      response_status is null
      or coalesce(response_timed_out,false)
      or nullif(btrim(coalesce(response_error,'')),'') is not null
      or response_status=408
      or response_status=429
      or response_status>=500;

    failure_reason:=case
      when retryable then 'retryable_transport_failure'
      when response_status>=200 and response_status<300
        then 'onesignal_not_created'
      else 'onesignal_rejected'
    end;

    update private.onesignal_outbox_attempts x
       set result_observed_at=pg_catalog.clock_timestamp(),
           http_status=response_status,
           timed_out=coalesce(response_timed_out,false),
           error_text=coalesce(response_error,failure_reason),
           response_body=response_body,
           semantic_outcome=case when retryable then 'retry' else 'failed' end
     where x.id=a.id;

    select o2.status,o2.attempt_count,o2.lease_token,o2.lease_expires_at
      into o
    from private.onesignal_outbox o2
    where o2.id=a.outbox_id;

    if not found or o.attempt_count<>a.attempt_no then
      -- A failure from an older attempt must never regress a newer state.
      return query select a.outbox_id,a.attempt_no,'stale_failure'::text;
      continue;
    end if;

    if retryable then
      update private.onesignal_outbox outbox
         set last_request_id=a.pg_net_request_id,
             last_http_status=response_status,
             last_error=coalesce(response_error,failure_reason),
             last_response_body=response_body,
             updated_at=pg_catalog.clock_timestamp()
       where outbox.id=a.outbox_id
         and outbox.attempt_count=a.attempt_no
         and outbox.status in ('sending','retry');

      if o.status='sending' and o.lease_token=a.lease_token then
        retry_state:=private.visionfood_onesignal_outbox_retry(
          a.outbox_id,
          a.attempt_no,
          a.lease_token,
          failure_reason,
          _retry_delay_seconds,
          _max_attempts
        );
      elsif o.status='retry' then
        retry_state:='retry';
      else
        retry_state:='stale';
      end if;

      return query select a.outbox_id,a.attempt_no,coalesce(retry_state,'stale');
      continue;
    end if;

    -- Definitive rejection applies only while this is still the newest attempt.
    update private.onesignal_outbox outbox
       set status='failed',
           lease_token=null,
           lease_owner=null,
           lease_expires_at=null,
           last_request_id=a.pg_net_request_id,
           last_http_status=response_status,
           last_error=failure_reason,
           last_response_body=response_body,
           failed_at=coalesce(
             outbox.failed_at,
             pg_catalog.clock_timestamp()
           ),
           updated_at=pg_catalog.clock_timestamp()
     where outbox.id=a.outbox_id
       and outbox.attempt_count=a.attempt_no
       and outbox.status in ('sending','retry')
       and (
         outbox.status='retry'
         or outbox.lease_token=a.lease_token
       );

    return query select a.outbox_id,a.attempt_no,'failed'::text;
  end loop;
end
$$;

revoke all on function private.visionfood_onesignal_outbox_reconcile(
  integer,integer,integer
) from public,anon,authenticated;
grant execute on function private.visionfood_onesignal_outbox_reconcile(
  integer,integer,integer
) to service_role;

drop function if exists private.visionfood_onesignal_outbox_run_once(
  integer,integer,integer,integer,integer
);

create or replace function private.visionfood_onesignal_outbox_run_once(
  _reconcile_batch_limit integer default 500,
  _dispatch_batch_limit integer default 100,
  _lease_seconds integer default 30,
  _retry_delay_seconds integer default 15,
  _max_attempts integer default 8,
  _max_rounds integer default 5
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
  reconcile_limit integer:=greatest(
    1,
    least(coalesce(_reconcile_batch_limit,500),500)
  );
  dispatch_limit integer:=greatest(
    1,
    least(coalesce(_dispatch_batch_limit,100),100)
  );
  max_rounds integer:=greatest(
    1,
    least(coalesce(_max_rounds,5),10)
  );
  reconciled_count integer:=0;
  dispatched_count integer:=0;
  round_dispatched integer:=0;
  dispatch_rounds integer:=0;
  rounds integer:=0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(runner_lock) then
    return pg_catalog.jsonb_build_object(
      'ok',true,
      'busy',true,
      'reconciled',0,
      'dispatched',0,
      'dispatch_rounds',0
    );
  end if;

  -- Reconcile once per tick. The reconciler itself prioritizes observable
  -- responses and expired current leases, so old late-response attempts cannot
  -- monopolize the bounded batch.
  select pg_catalog.count(*)
    into reconciled_count
  from private.visionfood_onesignal_outbox_reconcile(
    reconcile_limit,
    greatest(1,least(coalesce(_retry_delay_seconds,15),3600)),
    greatest(1,least(coalesce(_max_attempts,8),100))
  );

  -- Drain more than one dispatch batch when backlog exists, but cap the work
  -- per cron transaction. With defaults this is at most 5 x 100 rows/tick.
  loop
    rounds:=rounds+1;

    select pg_catalog.count(*)
      into round_dispatched
    from private.visionfood_onesignal_outbox_dispatch(
      'cron-outbox-v2:'||pg_catalog.pg_backend_pid()::text,
      dispatch_limit,
      greatest(5,least(coalesce(_lease_seconds,30),300)),
      greatest(1,least(coalesce(_retry_delay_seconds,15),3600)),
      greatest(1,least(coalesce(_max_attempts,8),100))
    );

    dispatched_count:=dispatched_count+round_dispatched;
    dispatch_rounds:=rounds;

    exit when round_dispatched<dispatch_limit or rounds>=max_rounds;
  end loop;

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'busy',false,
    'reconciled',reconciled_count,
    'dispatched',dispatched_count,
    'dispatch_rounds',dispatch_rounds,
    'dispatch_batch_limit',dispatch_limit,
    'max_dispatch_rounds',max_rounds
  );
end
$$;

revoke all on function private.visionfood_onesignal_outbox_run_once(
  integer,integer,integer,integer,integer,integer
) from public,anon,authenticated;

grant execute on function private.visionfood_onesignal_outbox_run_once(
  integer,integer,integer,integer,integer,integer
) to service_role;

-- Phase 27 rescue cursor: internal maintenance state, never client writable.
-- This migration has not been applied remotely; keep its cleanup definition
-- self-contained and safe before the later BRIN index migration is installed.
create table if not exists private.onesignal_brin_rescue_cursor (
  index_name text primary key check (index_name in (
    'private.onesignal_outbox_health_created_idx',
    'private.onesignal_outbox_attempts_health_created_idx'
  )),
  index_oid oid not null,
  next_page bigint not null default 0 check (next_page>=0)
);
alter table private.onesignal_brin_rescue_cursor enable row level security;
revoke all on private.onesignal_brin_rescue_cursor from public,anon,authenticated,service_role;

create or replace function private.visionfood_onesignal_outbox_cleanup(
  _terminal_retention interval default interval '30 days',
  _generation_retention interval default interval '45 days',
  _batch_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cleanup_lock bigint:=pg_catalog.hashtextextended(
    'visionfood:onesignal_outbox_v2_cleanup',
    0
  );
  terminal_retention interval:=greatest(
    coalesce(_terminal_retention,interval '30 days'),
    interval '30 days'
  );
  generation_retention interval:=greatest(
    coalesce(_generation_retention,interval '45 days'),
    interval '45 days'
  );
  batch_size integer:=greatest(
    1,
    least(coalesce(_batch_limit,500),5000)
  );
  pg_net_ttl interval:=interval '24 hours';
  late_response_horizon interval;
  sealed_attempts integer:=0;
  deleted_outbox integer:=0;
  deleted_generations integer:=0;
  deleted_vault_secrets integer:=0;
  deleted_cron_history integer:=0;
  summarized_outbox_ranges integer:=0;
  summarized_attempt_ranges integer:=0;
  rescue_name text;
  rescue_index regclass;
  rescue_heap regclass;
  rescue_ppr integer;
  rescue_pages bigint;
  rescue_page bigint;
  rescue_visits integer;
  rescue_count integer;
  rescue_deadline timestamptz;
  rescue_lock_skips integer:=0;
  rescue_total_visits integer:=0;
  saved_lock_timeout text;
  rescue_lock_timeout text;
  g record;
  secret_name text;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(cleanup_lock) then
    return pg_catalog.jsonb_build_object(
      'ok',true,
      'busy',true,
      'sealed_attempts',0,
      'deleted_outbox',0,
      'deleted_generations',0,
      'deleted_vault_secrets',0,
      'summarized_outbox_ranges',0,
      'summarized_attempt_ranges',0
    );
  end if;

  -- pg_net responses are retained for pg_net.ttl. Keep a conservative minimum
  -- 24h response window plus one hour of safety. If the setting is unavailable
  -- or unparsable, fail safe to the 24h minimum.
  begin
    pg_net_ttl:=nullif(
      pg_catalog.current_setting('pg_net.ttl',true),
      ''
    )::interval;
  exception
    when others then
      pg_net_ttl:=interval '24 hours';
  end;

  late_response_horizon:=
    greatest(
      coalesce(pg_net_ttl,interval '24 hours'),
      interval '24 hours'
    )
    + interval '1 hour';

  -- Missing responses intentionally stay unresolved in phase 3 so an old
  -- transport attempt can still win monotonically if success appears later.
  -- Seal only after:
  --   1) the entire response-retention horizon elapsed;
  --   2) the request is no longer queued for transmission;
  --   3) no matching response is still observable.
  -- Until then, terminal cleanup below is blocked by result_observed_at IS NULL.
  with stale_attempts as (
    select x.id
    from private.onesignal_outbox_attempts x
    where x.result_observed_at is null
      and coalesce(x.submitted_at,x.created_at)
            <=pg_catalog.clock_timestamp()-late_response_horizon
      and not exists (
        select 1
        from net.http_request_queue q
        where q.id=x.pg_net_request_id
      )
      and not exists (
        select 1
        from net._http_response r
        where r.id=x.pg_net_request_id
          and r.created>=coalesce(x.submitted_at,x.created_at)
      )
    order by coalesce(x.submitted_at,x.created_at),x.id
    for update of x skip locked
    limit batch_size
  )
  update private.onesignal_outbox_attempts x
     set result_observed_at=pg_catalog.clock_timestamp(),
         error_text=coalesce(
           x.error_text,
           'late_response_window_expired'
         ),
         semantic_outcome=coalesce(x.semantic_outcome,'retry')
    from stale_attempts s
   where x.id=s.id;

  get diagnostics sealed_attempts=row_count;

  -- Delete only terminal logical pushes. pending/sending/retry never enter this
  -- candidate set. A terminal row remains retained while any attempt is still
  -- open for late success, or while pg_net still has a queued request that may
  -- execute in the future.
  with terminal_candidates as (
    select o.id
    from private.onesignal_outbox o
    where o.status in ('delivered','failed')
      and case
            when o.status='delivered' then o.delivered_at
            else o.failed_at
          end
          <=pg_catalog.clock_timestamp()-terminal_retention
      and not exists (
        select 1
        from private.onesignal_outbox_attempts x
        where x.outbox_id=o.id
          and x.result_observed_at is null
      )
      and not exists (
        select 1
        from private.onesignal_outbox_attempts x
        join net.http_request_queue q
          on q.id=x.pg_net_request_id
        where x.outbox_id=o.id
      )
    order by
      case
        when o.status='delivered' then o.delivered_at
        else o.failed_at
      end,
      o.id
    for update of o skip locked
    limit batch_size
  )
  delete from private.onesignal_outbox o
  using terminal_candidates c
  where o.id=c.id;

  get diagnostics deleted_outbox=row_count;

  -- A generation may disappear only after every durable outbox reference is
  -- gone and it is no longer the live settings pointer. FOR UPDATE SKIP LOCKED
  -- conflicts with the enqueue FOR KEY SHARE above, so a producer that already
  -- snapshotted this generation keeps it alive until that transaction commits.
  for g in
    select
      gen.id,
      gen.api_key_secret_id
    from private.onesignal_config_generations gen
    where gen.created_at
            <=pg_catalog.clock_timestamp()-generation_retention
      and not exists (
        select 1
        from private.onesignal_settings s
        where s.config_generation_id=gen.id
           or s.api_key_secret_id=gen.api_key_secret_id
      )
      and not exists (
        select 1
        from private.onesignal_outbox o
        where o.config_generation_id=gen.id
      )
    order by gen.created_at,gen.id
    for update of gen skip locked
    limit batch_size
  loop
    secret_name:=null;

    select vs.name
      into secret_name
    from vault.secrets vs
    where vs.id=g.api_key_secret_id;

    delete from private.onesignal_config_generations gg
    where gg.id=g.id
      and not exists (
        select 1
        from private.onesignal_settings s
        where s.config_generation_id=g.id
           or s.api_key_secret_id=g.api_key_secret_id
      )
      and not exists (
        select 1
        from private.onesignal_outbox o
        where o.config_generation_id=g.id
      );

    if found then
      deleted_generations:=deleted_generations+1;

      -- Seeded/pre-V2 Vault rows may be shared with unknown legacy consumers.
      -- Auto-delete only secrets whose unique name proves this generation
      -- created/owns the row. Re-check all known references after deleting the
      -- generation metadata before removing the secret itself.
      if secret_name='onesignal_api_key::global::'||g.id::text
         and not exists (
           select 1
           from private.onesignal_config_generations gen2
           where gen2.api_key_secret_id=g.api_key_secret_id
         )
         and not exists (
           select 1
           from private.onesignal_settings s
           where s.api_key_secret_id=g.api_key_secret_id
         ) then
        delete from vault.secrets vs
        where vs.id=g.api_key_secret_id
          and vs.name='onesignal_api_key::global::'||g.id::text;

        if found then
          deleted_vault_secrets:=deleted_vault_secrets+1;
        end if;
      end if;
    end if;
  end loop;

  -- Supabase/pg_cron does not prune job_run_details automatically. The 15s
  -- runner would otherwise create 5,760 history rows/day even when healthy.
  -- Keep a bounded 7-day diagnostic window for this outbox pair only. Match
  -- both current job ids and historical command text so unschedule/reschedule
  -- cycles cannot orphan old run history forever.
  delete from cron.job_run_details d
  where coalesce(d.status,'')<>'running'
    and coalesce(d.end_time,d.start_time)
          <=pg_catalog.clock_timestamp()-interval '7 days'
    and (
      d.jobid in (
        select j.jobid
        from cron.job j
        where j.jobname in (
          'visionfood-onesignal-outbox-v2',
          'visionfood-onesignal-outbox-v2-cleanup'
        )
      )
      or coalesce(d.command,'') ilike '%visionfood_onesignal_outbox_run_once%'
      or coalesce(d.command,'') ilike '%visionfood_onesignal_outbox_cleanup%'
    );

  get diagnostics deleted_cron_history=row_count;

  -- Phase 27: rescue is incremental, not a full-heap maintenance sweep after
  -- DELETE. Count VISITS (even already summarized ranges) so an old prefix
  -- cannot consume unbounded revmap work. At ppr=8: <=64 MiB heap per index.
  -- 250ms is a cooperative budget, NOT a hard statement/I/O timeout; one range
  -- may overrun it. Use a short lock wait and preserve stricter caller settings.
  saved_lock_timeout:=pg_catalog.current_setting('lock_timeout');
  rescue_lock_timeout:=case
    when saved_lock_timeout::interval>interval '0'
     and saved_lock_timeout::interval<interval '100 milliseconds'
      then saved_lock_timeout
    else '100ms'
  end;
  perform pg_catalog.set_config('lock_timeout',rescue_lock_timeout,true);
  foreach rescue_name in array array[
    'private.onesignal_outbox_health_created_idx',
    'private.onesignal_outbox_attempts_health_created_idx'
  ] loop
    rescue_count:=0;
    rescue_visits:=0;
    -- A contended maintenance lock rolls back only this index's rescue work,
    -- including its cursor. Retention already performed above can still commit.
    begin
      rescue_index:=pg_catalog.to_regclass(rescue_name);
      if rescue_index is null then continue; end if;
      select i.indrelid,
        coalesce((select option_value::integer
          from pg_catalog.pg_options_to_table(c.reloptions)
          where option_name='pages_per_range'),128)
        into rescue_heap,rescue_ppr
      from pg_catalog.pg_index i
      join pg_catalog.pg_class c on c.oid=i.indexrelid
      join pg_catalog.pg_am am on am.oid=c.relam
      where i.indexrelid=rescue_index and i.indisvalid and am.amname='brin';
      if not found then continue; end if;
      rescue_pages:=pg_catalog.pg_relation_size(rescue_heap)/
        pg_catalog.current_setting('block_size')::bigint;
      insert into private.onesignal_brin_rescue_cursor(index_name,index_oid)
        values(rescue_name,rescue_index::oid)
        on conflict (index_name) do nothing;
      select case when c.index_oid=rescue_index::oid
                       and c.next_page<rescue_pages
                    then (c.next_page/rescue_ppr)*rescue_ppr else 0 end
        into rescue_page
      from private.onesignal_brin_rescue_cursor c
      where c.index_name=rescue_name;
      rescue_deadline:=pg_catalog.clock_timestamp()+interval '250 milliseconds';
      while rescue_page<rescue_pages and rescue_visits<1024
        and pg_catalog.clock_timestamp()<rescue_deadline loop
        rescue_count:=rescue_count+
          pg_catalog.brin_summarize_range(rescue_index,rescue_page);
        rescue_page:=rescue_page+rescue_ppr;
        rescue_visits:=rescue_visits+1;
      end loop;
      if rescue_page>=rescue_pages then rescue_page:=0; end if;
      update private.onesignal_brin_rescue_cursor
        set index_oid=rescue_index::oid,next_page=rescue_page
        where index_name=rescue_name;
    exception when lock_not_available then
      rescue_lock_skips:=rescue_lock_skips+1;
      rescue_count:=0;
      rescue_visits:=0;
    end;
    rescue_total_visits:=rescue_total_visits+rescue_visits;
    if rescue_name='private.onesignal_outbox_health_created_idx' then
      summarized_outbox_ranges:=rescue_count;
    else
      summarized_attempt_ranges:=rescue_count;
    end if;
  end loop;
  perform pg_catalog.set_config('lock_timeout',saved_lock_timeout,true);

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'busy',false,
    'deleted_cron_history',deleted_cron_history,
    'late_response_horizon_seconds',
      extract(epoch from late_response_horizon)::bigint,
    'terminal_retention_seconds',
      extract(epoch from terminal_retention)::bigint,
    'generation_retention_seconds',
      extract(epoch from generation_retention)::bigint,
    'sealed_attempts',sealed_attempts,
    'deleted_outbox',deleted_outbox,
    'deleted_generations',deleted_generations,
    'deleted_vault_secrets',deleted_vault_secrets,
    'summarized_outbox_ranges',summarized_outbox_ranges,
    'summarized_attempt_ranges',summarized_attempt_ranges,
    'brin_rescue_range_visits',rescue_total_visits,
    'brin_rescue_lock_skips',rescue_lock_skips
  );
end
$$;

revoke all on function private.visionfood_onesignal_outbox_cleanup(
  interval,interval,integer
) from public,anon,authenticated;
grant execute on function private.visionfood_onesignal_outbox_cleanup(
  interval,interval,integer
) to service_role;

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

  runner_jobid bigint;
  runner_active boolean:=false;
  runner_last_status text;
  runner_last_started_at timestamptz;
  runner_last_ended_at timestamptz;
  runner_last_success_at timestamptz;
  runner_failures_24h bigint:=0;

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
  reconcile_batch_limit integer:=500;
begin
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
    )
  into
    pending_due,
    retry_due,
    sending_count,
    expired_sending,
    failed_24h,
    oldest_due_at,
    oldest_sending_at
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

    select
      pg_catalog.max(coalesce(d.end_time,d.start_time)) filter (
        where d.status='succeeded'
      ),
      pg_catalog.count(*) filter (
        where d.start_time>=observed_at-interval '24 hours'
          and d.status not in ('succeeded','running')
      )
      into runner_last_success_at,runner_failures_24h
    from cron.job_run_details d
    where d.jobid=runner_jobid;
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
      'oldest_sending_seconds',oldest_sending_seconds
    ),
    'capacity',pg_catalog.jsonb_build_object(
      'reconcile_batch_limit',reconcile_batch_limit,
      'dispatch_batch_limit',dispatch_batch_limit,
      'dispatch_max_rounds',dispatch_max_rounds,
      'dispatch_capacity_per_tick',
        dispatch_batch_limit*dispatch_max_rounds,
      'dispatch_saturated',
        pending_due+retry_due>dispatch_batch_limit*dispatch_max_rounds,
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
      'runner_delayed',runner_delayed
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
