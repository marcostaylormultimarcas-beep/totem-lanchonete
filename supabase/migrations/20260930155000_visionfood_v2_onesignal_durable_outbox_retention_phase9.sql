-- OneSignal Durable Outbox V2 - phase 9.
--
-- Operational retention after the periodic liveness runner.
--
-- Safety invariants:
--   * pending/sending/retry outbox rows are never retention candidates;
--   * terminal rows are retained for at least 30 days;
--   * unresolved attempts remain eligible for late semantic success until the
--     pg_net response window is provably closed;
--   * queued pg_net requests keep their outbox/generation alive;
--   * immutable generations are retired only when neither settings nor any
--     outbox row references them;
--   * only Vault secrets created by the immutable V2 generation naming scheme
--     are auto-deleted, and only after their generation is gone and no live
--     reference remains.

create extension if not exists pg_cron;

-- Keep a generation reference open from snapshot through the producer
-- transaction. This does not lock the live settings row and therefore does not
-- reintroduce the phase-7 rotation guards. It only prevents retention from
-- deleting the exact immutable generation between snapshot and outbox INSERT.
create or replace function private.visionfood_onesignal_outbox_enqueue(
  _organization_id uuid,
  _push_type text,
  _source_kind text,
  _source_key text,
  _audience jsonb,
  _payload jsonb,
  _idempotency_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  logical_key uuid:=coalesce(_idempotency_key,gen_random_uuid());
  generation_id uuid;
  generation_app_id text;
  frozen_data jsonb;
  frozen_payload jsonb;
  existing private.onesignal_outbox%rowtype;
  created_id uuid;
begin
  if _organization_id is null then
    raise exception 'onesignal_outbox_organization_required'
      using errcode='22023';
  end if;

  if nullif(btrim(coalesce(_push_type,'')),'') is null
     or nullif(btrim(coalesce(_source_kind,'')),'') is null
     or nullif(btrim(coalesce(_source_key,'')),'') is null then
    raise exception 'onesignal_outbox_source_required'
      using errcode='22023';
  end if;

  if _audience is null
     or jsonb_typeof(_audience)<>'object'
     or _audience='{}'::jsonb then
    raise exception 'onesignal_outbox_invalid_audience'
      using errcode='22023';
  end if;

  if _audience ?| array['app_id','idempotency_key','data','target_channel'] then
    raise exception 'onesignal_outbox_reserved_audience_field'
      using errcode='22023';
  end if;

  if _payload is null or jsonb_typeof(_payload)<>'object' then
    raise exception 'onesignal_outbox_invalid_payload'
      using errcode='22023';
  end if;

  frozen_data:=coalesce(_payload->'data','{}'::jsonb);
  if jsonb_typeof(frozen_data)<>'object' then
    raise exception 'onesignal_outbox_invalid_payload_data'
      using errcode='22023';
  end if;

  select o.*
    into existing
  from private.onesignal_outbox o
  where o.idempotency_key=logical_key;

  if found then
    frozen_payload:=
      (((_payload-'app_id')-'idempotency_key')-'data')
      || _audience
      || jsonb_build_object(
           'app_id',existing.app_id,
           'idempotency_key',logical_key::text,
           'target_channel','push',
           'data',frozen_data || jsonb_build_object(
             'organization_id',_organization_id::text
           )
         );

    if existing.organization_id is distinct from _organization_id
       or existing.push_type is distinct from btrim(_push_type)
       or existing.source_kind is distinct from btrim(_source_kind)
       or existing.source_key is distinct from btrim(_source_key)
       or existing.audience is distinct from _audience
       or existing.payload is distinct from frozen_payload then
      raise exception 'onesignal_outbox_idempotency_conflict'
        using errcode='23505';
    end if;

    return existing.id;
  end if;

  select s.config_generation_id,s.app_id
    into generation_id,generation_app_id
  from private.onesignal_settings s
  join private.onesignal_config_generations g
    on g.id=s.config_generation_id
   and g.app_id=s.app_id
   and g.api_key_secret_id=s.api_key_secret_id
  where s.id='global'
    and nullif(btrim(coalesce(s.app_id,'')),'') is not null
    and s.config_generation_id is not null
  for key share of g;

  if not found then
    raise exception 'onesignal_outbox_not_configured'
      using errcode='55000';
  end if;

  frozen_payload:=
    (((_payload-'app_id')-'idempotency_key')-'data')
    || _audience
    || jsonb_build_object(
         'app_id',generation_app_id,
         'idempotency_key',logical_key::text,
         'target_channel','push',
         'data',frozen_data || jsonb_build_object(
           'organization_id',_organization_id::text
         )
       );

  insert into private.onesignal_outbox(
    organization_id,
    push_type,
    source_kind,
    source_key,
    config_generation_id,
    app_id,
    audience,
    payload,
    idempotency_key
  )
  values(
    _organization_id,
    btrim(_push_type),
    btrim(_source_kind),
    btrim(_source_key),
    generation_id,
    generation_app_id,
    _audience,
    frozen_payload,
    logical_key
  )
  on conflict (idempotency_key) do nothing
  returning id into created_id;

  if created_id is not null then
    return created_id;
  end if;

  select o.*
    into existing
  from private.onesignal_outbox o
  where o.idempotency_key=logical_key;

  if not found then
    raise exception 'onesignal_outbox_idempotency_conflict'
      using errcode='23505';
  end if;

  frozen_payload:=
    (((_payload-'app_id')-'idempotency_key')-'data')
    || _audience
    || jsonb_build_object(
         'app_id',existing.app_id,
         'idempotency_key',logical_key::text,
         'target_channel','push',
         'data',frozen_data || jsonb_build_object(
           'organization_id',_organization_id::text
         )
       );

  if existing.organization_id is distinct from _organization_id
     or existing.push_type is distinct from btrim(_push_type)
     or existing.source_kind is distinct from btrim(_source_kind)
     or existing.source_key is distinct from btrim(_source_key)
     or existing.audience is distinct from _audience
     or existing.payload is distinct from frozen_payload then
    raise exception 'onesignal_outbox_idempotency_conflict'
      using errcode='23505';
  end if;

  return existing.id;
end
$$;

revoke all on function private.visionfood_onesignal_outbox_enqueue(uuid,text,text,text,jsonb,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function private.visionfood_onesignal_outbox_enqueue(uuid,text,text,text,jsonb,jsonb,uuid)
  to service_role;

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
      'deleted_vault_secrets',0
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

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'busy',false,
    'late_response_horizon_seconds',
      extract(epoch from late_response_horizon)::bigint,
    'terminal_retention_seconds',
      extract(epoch from terminal_retention)::bigint,
    'generation_retention_seconds',
      extract(epoch from generation_retention)::bigint,
    'sealed_attempts',sealed_attempts,
    'deleted_outbox',deleted_outbox,
    'deleted_generations',deleted_generations,
    'deleted_vault_secrets',deleted_vault_secrets
  );
end
$$;

revoke all on function private.visionfood_onesignal_outbox_cleanup(interval,interval,integer)
  from public,anon,authenticated;
grant execute on function private.visionfood_onesignal_outbox_cleanup(interval,interval,integer)
  to service_role;

-- Retention has a separate low-frequency wake-up from the 15s liveness runner.
-- 500 rows every 10 minutes is deliberately bounded while still allowing up to
-- 72k terminal rows/day to be retired without producer activity.
do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname='visionfood-onesignal-outbox-v2-cleanup'
  ) then
    perform cron.unschedule('visionfood-onesignal-outbox-v2-cleanup');
  end if;

  perform cron.schedule(
    'visionfood-onesignal-outbox-v2-cleanup',
    '*/10 * * * *',
    $cron$
      select private.visionfood_onesignal_outbox_cleanup();
    $cron$
  );
end
$$;
