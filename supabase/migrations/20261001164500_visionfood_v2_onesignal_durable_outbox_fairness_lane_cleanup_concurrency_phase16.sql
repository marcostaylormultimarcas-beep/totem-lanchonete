-- OneSignal Durable Outbox V2 - phase 16.
--
-- Stabilize fairness-lane cleanup under concurrent claimers/cleaners.
--
-- Failure proven before this fix:
--   * phase 15 used OFFSET in the same SELECT that carried
--     FOR UPDATE SKIP LOCKED;
--   * PostgreSQL row-locks rows stepped over by OFFSET, even when those rows
--     are not returned;
--   * at the 33-lane soft-pool boundary, one claimer could therefore hold its
--     own lane plus row-lock the other 32 lanes while deleting nothing;
--   * concurrent claimers then observed no reusable committed lane and created
--     new lanes, producing cleanup -> creation -> cleanup churn;
--   * the idle-floor path had the same lock amplification;
--   * excluding the current lane before OFFSET also made the effective steady
--     pool/floor one row larger than their declared values.
--
-- Fix:
--   * preserve the newest soft pool/floor by a read-only indexed cutoff;
--   * FOR UPDATE SKIP LOCKED is applied only to rows older than that cutoff,
--     so protected lanes remain reusable by concurrent workers;
--   * cleanup candidates remain bounded to lane_cleanup_batch and locked lanes
--     remain untouched, preserving long-transaction liveness;
--   * concurrent cleaners may partition candidate rows through SKIP LOCKED but
--     cannot cross the same snapshot's protected cutoff;
--   * pressure cleanup converges to exactly 32 total lanes and idle cleanup to
--     exactly 8 total lanes when enough rows are unlocked;
--   * cleanup never reads or mutates last_organization_id/fairness_progress;
--     cursor advancement remains coupled only to effective claims;
--   * lane creation/deletion stay transaction-scoped, so rollback/crash is
--     safe and sequence gaps remain harmless.
--
-- The existing (updated_at,id) index from phase 15 supports the fixed-size
-- cutoff probes and bounded candidate scans.
--
-- This migration is intentionally not applied remotely here.

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
  fairness_lane_id bigint;
  claim_cursor uuid;
  lane_floor integer:=8;
  lane_soft_limit integer:=32;
  lane_cleanup_batch integer:=16;
  lane_idle_ttl interval:=interval '15 minutes';
begin
  if worker_name='' then
    raise exception 'onesignal_outbox_worker_required'
      using errcode='22023';
  end if;

  -- Reuse the least-recently-used unlocked cursor lane. The row lock still
  -- lives until transaction end, but no worker waits on a busy lane.
  select s.id,s.last_organization_id
    into fairness_lane_id,claim_cursor
  from private.onesignal_outbox_claim_fairness_state s
  order by s.updated_at,s.id
  for update of s skip locked
  limit 1;

  if found then
    -- Recency and cursor progression are deliberately separate. Rotating the
    -- lane on every committed acquisition prevents a zero-claim lane, or a
    -- lane returning from a long transaction, from monopolizing future picks.
    -- last_organization_id is untouched here and still advances only from the
    -- claim-coupled fairness_progress CTE below.
    update private.onesignal_outbox_claim_fairness_state
       set updated_at=pg_catalog.clock_timestamp()
     where id=fairness_lane_id;
  else
    -- All committed lanes are currently locked. Create a temporary capacity
    -- lane rather than blocking. Concurrent uncommitted inserts may each
    -- allocate a bigint id; rolled-back inserts leave only harmless sequence
    -- gaps, while committed excess is compacted after it becomes idle.
    select s.last_organization_id
      into claim_cursor
    from private.onesignal_outbox_claim_fairness_state s
    order by s.updated_at desc,s.id desc
    limit 1;

    insert into private.onesignal_outbox_claim_fairness_state(
      last_organization_id,
      updated_at
    )
    values(
      claim_cursor,
      pg_catalog.clock_timestamp()
    )
    returning id into fairness_lane_id;
  end if;

  -- Keep the most-recently-used soft pool without locking the rows that are
  -- only being preserved. PostgreSQL locks rows stepped over by OFFSET when
  -- OFFSET is inside SELECT ... FOR UPDATE, so phase 15 could lock the entire
  -- protected pool and make concurrent claimers create needless new lanes.
  -- Read the fixed-rank cutoff without a row lock, then lock only rows that are
  -- actually older than that cutoff and therefore eligible for DELETE.
  with pressure_cleanup_cutoff as materialized (
    select s.updated_at,s.id
    from private.onesignal_outbox_claim_fairness_state s
    order by s.updated_at desc,s.id desc
    offset lane_soft_limit-1
    limit 1
  ), pressure_cleanup_candidates as (
    select s.id
    from private.onesignal_outbox_claim_fairness_state s
    cross join pressure_cleanup_cutoff cutoff
    where s.id<>fairness_lane_id
      and (s.updated_at,s.id)<(cutoff.updated_at,cutoff.id)
    order by s.updated_at,s.id
    for update of s skip locked
    limit lane_cleanup_batch
  )
  delete from private.onesignal_outbox_claim_fairness_state s
  using pressure_cleanup_candidates cleanup
  where s.id=cleanup.id;

  -- After traffic has cooled, compact old capacity toward the exact multi-lane
  -- floor. As above, determine the protected floor with a read-only cutoff and
  -- take row locks only on stale rows that are truly outside that floor.
  with idle_cleanup_cutoff as materialized (
    select s.updated_at,s.id
    from private.onesignal_outbox_claim_fairness_state s
    order by s.updated_at desc,s.id desc
    offset lane_floor-1
    limit 1
  ), idle_cleanup_candidates as (
    select s.id
    from private.onesignal_outbox_claim_fairness_state s
    cross join idle_cleanup_cutoff cutoff
    where s.id<>fairness_lane_id
      and s.updated_at<
        pg_catalog.clock_timestamp()-lane_idle_ttl
      and (s.updated_at,s.id)<(cutoff.updated_at,cutoff.id)
    order by s.updated_at,s.id
    for update of s skip locked
    limit lane_cleanup_batch
  )
  delete from private.onesignal_outbox_claim_fairness_state s
  using idle_cleanup_candidates cleanup
  where s.id=cleanup.id;

  return query
  with recursive active_organizations_forward(
    organization_id,
    organization_ordinal
  ) as (
    (
      select
        o.organization_id,
        1::integer
      from private.onesignal_outbox o
      where o.status in ('pending','retry')
        and o.available_at<=pg_catalog.clock_timestamp()
        and (
          claim_cursor is null
          or o.organization_id>claim_cursor
        )
      order by o.organization_id
      limit 1
    )

    union all

    select
      next_org.organization_id,
      current_org.organization_ordinal+1
    from active_organizations_forward current_org
    cross join lateral (
      select o.organization_id
      from private.onesignal_outbox o
      where o.status in ('pending','retry')
        and o.available_at<=pg_catalog.clock_timestamp()
        and o.organization_id>current_org.organization_id
      order by o.organization_id
      limit 1
    ) next_org
    where current_org.organization_ordinal<batch_size
  ), forward_stats as (
    select pg_catalog.count(*)::integer as forward_count
    from active_organizations_forward
  ), active_organizations_wrapped(
    organization_id,
    organization_ordinal
  ) as (
    (
      select
        first_org.organization_id,
        stats.forward_count+1
      from forward_stats stats
      cross join lateral (
        select o.organization_id
        from private.onesignal_outbox o
        where o.status in ('pending','retry')
          and o.available_at<=pg_catalog.clock_timestamp()
          and claim_cursor is not null
          and o.organization_id<=claim_cursor
        order by o.organization_id
        limit 1
      ) first_org
      where stats.forward_count<batch_size
    )

    union all

    select
      next_org.organization_id,
      wrapped_org.organization_ordinal+1
    from active_organizations_wrapped wrapped_org
    cross join lateral (
      select o.organization_id
      from private.onesignal_outbox o
      where o.status in ('pending','retry')
        and o.available_at<=pg_catalog.clock_timestamp()
        and claim_cursor is not null
        and o.organization_id>wrapped_org.organization_id
        and o.organization_id<=claim_cursor
      order by o.organization_id
      limit 1
    ) next_org
    where wrapped_org.organization_ordinal<batch_size
  ), active_organizations as (
    select
      o.organization_id,
      o.organization_ordinal
    from active_organizations_forward o

    union all

    select
      o.organization_id,
      o.organization_ordinal
    from active_organizations_wrapped o
  ), per_organization_candidates as (
    select
      c.id,
      c.organization_id,
      c.available_at,
      c.created_at,
      active_org.organization_ordinal
    from active_organizations active_org
    cross join lateral (
      select
        o.id,
        o.organization_id,
        o.available_at,
        o.created_at
      from private.onesignal_outbox o
      where o.organization_id=active_org.organization_id
        and o.status in ('pending','retry')
        and o.available_at<=pg_catalog.clock_timestamp()
      order by o.available_at,o.created_at,o.id
      limit batch_size
    ) c
  ), ranked as (
    select
      p.id,
      p.organization_id,
      p.available_at,
      p.created_at,
      p.organization_ordinal,
      row_number() over (
        partition by p.organization_id
        order by p.available_at,p.created_at,p.id
      ) as organization_rank
    from per_organization_candidates p
  ), candidates as (
    select
      o.id,
      r.organization_id,
      r.organization_ordinal
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
      o.organization_id,
      o.attempt_count,
      o.lease_token,
      o.app_id,
      o.config_generation_id,
      o.payload
  ), served_organizations as (
    select distinct c.organization_id
    from claimed c
  ), first_unserved as (
    select
      pg_catalog.min(a.organization_ordinal)::integer
        as first_unserved_ordinal
    from active_organizations a
    left join served_organizations served
      on served.organization_id=a.organization_id
    where served.organization_id is null
  ), advance_target as (
    select a.organization_id
    from active_organizations a
    cross join first_unserved gap
    where a.organization_ordinal=(
      case
        when gap.first_unserved_ordinal is null then (
          select pg_catalog.max(all_active.organization_ordinal)
          from active_organizations all_active
        )
        else gap.first_unserved_ordinal-1
      end
    )
    limit 1
  ), fairness_progress as (
    update private.onesignal_outbox_claim_fairness_state s
       set last_organization_id=pg_catalog.coalesce(
             progress.organization_id,
             s.last_organization_id
           ),
           updated_at=pg_catalog.clock_timestamp()
      from (
        select
          (
            select target.organization_id
            from advance_target target
            limit 1
          ) as organization_id
      ) progress
     where s.id=fairness_lane_id
       and exists(
         select 1
         from claimed effective_claim
       )
    returning s.id
  )
  select
    c.id,
    c.attempt_count,
    c.lease_token,
    c.app_id,
    c.config_generation_id,
    c.payload
  from claimed c
  cross join (
    select pg_catalog.count(*) as fairness_progress_count
    from fairness_progress
  ) progress_barrier;
end
$$;

revoke all on function private.visionfood_onesignal_outbox_claim(
  text,integer,integer
) from public,anon,authenticated,service_role;
