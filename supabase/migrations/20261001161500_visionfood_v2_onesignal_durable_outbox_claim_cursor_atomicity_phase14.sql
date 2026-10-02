-- OneSignal Durable Outbox V2 - phase 14.
--
-- Make claim fairness progress atomic with effective claims and remove the
-- transaction-long singleton cursor bottleneck introduced in phase 13.
--
-- Failure proven before this fix:
--   * the phase-13 cursor advanced from the visited organization window even
--     when SKIP LOCKED left the worker with zero effective claims;
--   * a visited-but-unclaimed organization could therefore be passed and wait
--     until wrap-around after the conflicting lock holder rolled back;
--   * the singleton row lock is retained until the caller transaction ends, so
--     long transactions force every concurrent worker onto the fallback path;
--   * fallback_cursor=gen_random_uuid() is biased by UUID keyspace gaps and can
--     make multiple workers collide on the same organization window.
--
-- Keep phase-13 bounded enumeration and deep contention prefixes. Replace the
-- singleton with durable cursor lanes: an unlocked lane is reused, and when all
-- existing lanes are transaction-locked a new lane is created. Each lane moves
-- only through the contiguous prefix of visited organizations that actually
-- produced at least one claimed row. Claim rows and cursor movement remain in
-- the same transaction, so rollback/crash reverts both.
--
-- This migration is intentionally not applied remotely here.

alter table private.onesignal_outbox_claim_fairness_state
  drop constraint if exists onesignal_outbox_claim_fairness_state_singleton;

alter table private.onesignal_outbox_claim_fairness_state
  alter column id type bigint;

create sequence if not exists private.onesignal_outbox_claim_fairness_lane_seq;

select pg_catalog.setval(
  'private.onesignal_outbox_claim_fairness_lane_seq'::regclass,
  pg_catalog.greatest(
    coalesce(
      (
        select pg_catalog.max(s.id)
        from private.onesignal_outbox_claim_fairness_state s
      ),
      1
    ),
    1
  ),
  true
);

alter sequence private.onesignal_outbox_claim_fairness_lane_seq
  owned by private.onesignal_outbox_claim_fairness_state.id;

alter table private.onesignal_outbox_claim_fairness_state
  alter column id
  set default pg_catalog.nextval(
    'private.onesignal_outbox_claim_fairness_lane_seq'::regclass
  );

alter table private.onesignal_outbox_claim_fairness_state
  drop constraint if exists onesignal_outbox_claim_fairness_state_id_positive;

alter table private.onesignal_outbox_claim_fairness_state
  add constraint onesignal_outbox_claim_fairness_state_id_positive
  check(id>0);

revoke all on sequence private.onesignal_outbox_claim_fairness_lane_seq
  from public,anon,authenticated,service_role;

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
begin
  if worker_name='' then
    raise exception 'onesignal_outbox_worker_required'
      using errcode='22023';
  end if;

  -- Reuse one unlocked cursor lane. Row locks still live until transaction end,
  -- but they are no longer global: another worker can use another lane.
  select s.id,s.last_organization_id
    into fairness_lane_id,claim_cursor
  from private.onesignal_outbox_claim_fairness_state s
  order by s.updated_at,s.id
  for update of s skip locked
  limit 1;

  if not found then
    -- All committed lanes are currently locked by other transactions. Create a
    -- new durable lane instead of choosing a random UUID fallback. Sequence
    -- allocation is contention-safe and a rolled-back lane insert disappears
    -- with the transaction.
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
       set last_organization_id=coalesce(
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
