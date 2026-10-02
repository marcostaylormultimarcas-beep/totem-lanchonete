-- OneSignal Durable Outbox V2 - phase 11.
--
-- Organization-aware fairness for claim/dispatch/reconcile under asymmetric
-- backlog. Preserve logical FIFO inside each organization and keep all frozen
-- request fields immutable. pg_net remains transport only.
--
-- Failure proven before this fix:
-- the phase-3 claim ordered the whole due queue globally and applied LIMIT
-- before considering organization_id. A tenant with > batch_size older rows
-- could therefore occupy every slot in every bounded dispatch round. Phase-10
-- reconcile had the same global batching property for unresolved attempts.

create index if not exists onesignal_outbox_org_due_fairness_idx
  on private.onesignal_outbox(
    organization_id,
    available_at,
    created_at,
    id
  )
  where status in ('pending','retry');

-- Claim remains concurrent and bounded, but ranking happens per organization.
-- organization_rank=1 is each tenant's oldest due row, rank=2 its next row, etc.
-- Ordering by rank first interleaves active tenants while preserving FIFO
-- (available_at, created_at, id) inside every tenant.
create or replace function private.visionfood_onesignal_outbox_claim(
  _worker text,
  _batch_limit integer default 10,
  _lease_seconds integer default 30
)
returns table(
  claimed_outbox_id uuid,
  claimed_attempt_no integer,
  claimed_lease_token uuid,
  claimed_app_id text,
  claimed_generation_id uuid,
  claimed_payload jsonb
)
language plpgsql
security definer
set search_path=''
as $$
declare
  worker_name text:=left(btrim(coalesce(_worker,'')),200);
  batch_size integer:=greatest(1,least(coalesce(_batch_limit,10),100));
  lease_seconds integer:=greatest(5,least(coalesce(_lease_seconds,30),300));
begin
  if worker_name='' then
    raise exception 'onesignal_outbox_worker_required'
      using errcode='22023';
  end if;

  return query
  with ranked as materialized (
    select
      o.id,
      o.organization_id,
      o.available_at,
      o.created_at,
      row_number() over (
        partition by o.organization_id
        order by o.available_at,o.created_at,o.id
      ) as organization_rank
    from private.onesignal_outbox o
    where o.status in ('pending','retry')
      and o.available_at<=pg_catalog.clock_timestamp()
  ), candidates as (
    select o.id
    from ranked r
    join private.onesignal_outbox o
      on o.id=r.id
    where o.status in ('pending','retry')
      and o.available_at<=pg_catalog.clock_timestamp()
    order by r.organization_rank,r.available_at,r.created_at,r.id
    for update of o skip locked
    limit batch_size
  ), claimed as (
    update private.onesignal_outbox o
       set status='sending',
           attempt_count=o.attempt_count+1,
           lease_token=gen_random_uuid(),
           lease_owner=worker_name,
           lease_expires_at=pg_catalog.clock_timestamp()
             + pg_catalog.make_interval(secs=>lease_seconds),
           last_attempt_at=pg_catalog.clock_timestamp(),
           first_sending_at=coalesce(
             o.first_sending_at,
             pg_catalog.clock_timestamp()
           ),
           last_error=null,
           updated_at=pg_catalog.clock_timestamp()
      from candidates c
     where o.id=c.id
    returning
      o.id,
      o.attempt_count,
      o.lease_token,
      o.app_id,
      o.config_generation_id,
      o.payload
  )
  select
    c.id,
    c.attempt_count,
    c.lease_token,
    c.app_id,
    c.config_generation_id,
    c.payload
  from claimed c;
end
$$;

revoke all on function private.visionfood_onesignal_outbox_claim(
  text,integer,integer
) from public,anon,authenticated,service_role;

-- Reconcile keeps the phase-10 urgency ordering *inside each organization*
-- (observable response first, then expired current lease), then interleaves
-- organizations by their per-tenant ordinal. A large tenant can no longer fill
-- the entire bounded reconcile batch by itself.
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
    with prioritized as materialized (
      select
        x.id,
        x.outbox_id,
        x.attempt_no,
        x.lease_token,
        x.pg_net_request_id,
        x.created_at,
        x.submitted_at,
        current_o.organization_id,
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
          when current_o.status='sending'
            and current_o.attempt_count=x.attempt_no
            and current_o.lease_token=x.lease_token
            and current_o.lease_expires_at<=pg_catalog.clock_timestamp()
          then 0
          else 1
        end as lease_priority
      from private.onesignal_outbox_attempts x
      join private.onesignal_outbox current_o
        on current_o.id=x.outbox_id
      where x.result_observed_at is null
        and x.pg_net_request_id is not null
    ), ranked as materialized (
      select
        prioritized.*,
        row_number() over (
          partition by prioritized.organization_id
          order by prioritized.response_priority,prioritized.lease_priority,
                   prioritized.submitted_at,prioritized.id
        ) as organization_rank
      from prioritized
    )
    select
      x.*,
      ranked.organization_id,
      ranked.response_priority,
      ranked.lease_priority,
      ranked.organization_rank
    from ranked
    join private.onesignal_outbox_attempts x
      on x.id=ranked.id
    where x.result_observed_at is null
      and x.pg_net_request_id is not null
    order by ranked.organization_rank,ranked.response_priority,
             ranked.lease_priority,ranked.submitted_at,ranked.id
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
