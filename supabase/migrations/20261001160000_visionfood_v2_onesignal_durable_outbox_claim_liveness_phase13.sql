-- OneSignal Durable Outbox V2 - phase 13.
--
-- Bound organization enumeration and preserve claim liveness under contention.
--
-- Failure proven before this fix:
--   * phase 12 enumerated every active organization before calculating a small
--     batch, so claim cost still grew with organization cardinality;
--   * the phase-12 per-organization prefix could be exactly exhausted by a
--     concurrent worker before the outer FOR UPDATE SKIP LOCKED, causing a
--     second worker to underfill even while deeper due rows existed;
--   * when active organizations exceeded batch_size, ordering rank-1 rows by
--     oldest due timestamp could repeatedly select the same organizations
--     across ticks and starve newer organizations.
--
-- Keep the immutable logical request contract untouched. pg_net remains
-- transport only. This migration is intentionally not applied remotely here.

create table if not exists private.onesignal_outbox_claim_fairness_state (
  id smallint primary key,
  last_organization_id uuid,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint onesignal_outbox_claim_fairness_state_singleton
    check (id=1)
);

revoke all on table private.onesignal_outbox_claim_fairness_state
  from public,anon,authenticated,service_role;

insert into private.onesignal_outbox_claim_fairness_state(
  id,
  last_organization_id
)
values(1,null)
on conflict(id) do nothing;

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
  claim_cursor uuid;
  fallback_cursor uuid;
  owns_fairness_cursor boolean:=false;
begin
  if worker_name='' then
    raise exception 'onesignal_outbox_worker_required'
      using errcode='22023';
  end if;

  -- One claimant advances the durable round-robin cursor without making other
  -- workers wait. A concurrent claimant skips the locked singleton and starts
  -- from an independent fallback cursor instead.
  select s.last_organization_id
    into claim_cursor
  from private.onesignal_outbox_claim_fairness_state s
  where s.id=1
  for update of s skip locked;

  owns_fairness_cursor:=found;

  if not owns_fairness_cursor then
    fallback_cursor:=gen_random_uuid();
    claim_cursor:=fallback_cursor;
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
  ), advance_fairness_cursor as (
    update private.onesignal_outbox_claim_fairness_state s
       set last_organization_id=last_org.organization_id,
           updated_at=pg_catalog.clock_timestamp()
      from (
        select
          active_org.organization_id
        from active_organizations active_org
        order by active_org.organization_ordinal desc
        limit 1
      ) last_org
     where s.id=1
       and owns_fairness_cursor
    returning s.id
  ), per_organization_candidates as (
    -- Fetch a contention prefix that is deeper than the old quota. The outer
    -- SKIP LOCKED can therefore step past rows claimed by another worker rather
    -- than exhausting a tiny pre-lock prefix. Cost remains bounded at
    -- batch_size organizations x batch_size rows.
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
