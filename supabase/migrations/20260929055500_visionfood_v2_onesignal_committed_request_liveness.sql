-- Bound the committed-request cutover barrier without confusing an arbitrary
-- queue-row locker with the pg_net worker that actually claimed the OneSignal
-- request.
--
-- Normal safety is preserved:
--   * configuration rotation still owns the settings row and exclusive
--     generation advisory guard before touching the queue;
--   * old-generation requests that are still merely queued are cancelled under
--     FOR UPDATE SKIP LOCKED, so they cannot wake later with revoked credentials;
--   * a request DELETE-claimed by pg_net is identified by the tuple's xmax,
--     which must match pg_stat_activity.backend_xid for the pg_net worker;
--   * a remaining row locked by any non-pg_net session stays fail-closed because
--     it can become sendable again after that locker releases it.
--
-- Liveness for a genuine in-flight OneSignal request remains bounded by that
-- request's own timeout plus a 10 second worker/commit grace. Other non-OneSignal
-- requests in the same pg_net batch do not extend the OneSignal credential
-- barrier merely because they share the worker transaction.

create or replace function public.set_onesignal_config(
  _app_id text,
  _api_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c private.onesignal_settings%rowtype;
  sid uuid;
  app text:=btrim(coalesce(_app_id,''));
  key text:=btrim(coalesce(_api_key,''));
  previous_app_id text:='';
  has_key boolean:=false;
  config_guard bigint:=pg_catalog.hashtextextended(
    'visionfood:onesignal_config',
    0
  );
  changes_generation boolean:=false;
  worker_xid xid;
  worker_xact_start timestamptz;
  in_flight_timeout_ms integer:=0;
begin
  if app<>'' and app !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok',false,'reason','invalid_app_id');
  end if;

  if key<>'' and (length(key)<20 or length(key)>1000) then
    return jsonb_build_object('ok',false,'reason','invalid_api_key');
  end if;

  -- Preserve the established config -> queue lock order.
  select * into c
  from private.onesignal_settings
  where id='global'
  for update;

  -- A direct queue caller that has not committed yet owns the matching shared
  -- generation guard. Never wait behind it while the settings row is locked.
  if not pg_catalog.pg_try_advisory_xact_lock(config_guard) then
    return jsonb_build_object('ok',false,'reason','config_busy');
  end if;

  previous_app_id:=btrim(coalesce(c.app_id,''));
  sid:=c.api_key_secret_id;
  changes_generation:=
    app is distinct from previous_app_id
    or key<>'';

  if changes_generation and previous_app_id<>'' then
    -- Cancel old-generation requests that are still waiting in the queue.
    -- SKIP LOCKED is essential: a row already DELETE-claimed by the pg_net
    -- worker must not make this configuration transaction wait on its row lock.
    with cancellable as (
      select q.id
      from net.http_request_queue q
      where q.method='POST'
        and q.url='https://api.onesignal.com/notifications'
        and q.body is not null
        and (
          pg_catalog.convert_from(q.body,'UTF8')::jsonb
          ->> 'app_id'
        )=previous_app_id
      for update skip locked
    )
    delete from net.http_request_queue q
    using cancellable cdr
    where q.id=cdr.id;

    -- If an old-generation row remains, prove that the exact tuple was claimed
    -- by the pg_net worker. An unrelated pg_net transaction is not evidence of
    -- ownership: q.xmax is the deleting/locking transaction id for this tuple.
    if exists(
      select 1
      from net.http_request_queue q
      where q.method='POST'
        and q.url='https://api.onesignal.com/notifications'
        and q.body is not null
        and (
          pg_catalog.convert_from(q.body,'UTF8')::jsonb
          ->> 'app_id'
        )=previous_app_id
    ) then
      worker_xid:=null;
      worker_xact_start:=null;

      select a.backend_xid, a.xact_start
        into worker_xid, worker_xact_start
      from net.http_request_queue q
      join pg_catalog.pg_stat_activity a
        on a.datname=pg_catalog.current_database()
       and a.backend_type ilike '%pg_net%'
       and a.backend_xid=q.xmax
      where q.method='POST'
        and q.url='https://api.onesignal.com/notifications'
        and q.body is not null
        and (
          pg_catalog.convert_from(q.body,'UTF8')::jsonb
          ->> 'app_id'
        )=previous_app_id
      order by a.xact_start
      limit 1;

      -- A row skipped because some other session locked it is still a queued
      -- request, not completed pg_net work. Rotating now could let that row be
      -- transmitted later with the revoked generation after its locker exits.
      if worker_xact_start is null then
        return jsonb_build_object('ok',false,'reason','config_busy');
      end if;

      -- Bound only the OneSignal request(s) owned by this exact worker
      -- transaction. A long unrelated request in the same curl_multi batch must
      -- not create a false credential barrier after the OneSignal timeout has
      -- elapsed.
      select coalesce(pg_catalog.max(q.timeout_milliseconds),0)
        into in_flight_timeout_ms
      from net.http_request_queue q
      where q.xmax=worker_xid
        and q.method='POST'
        and q.url='https://api.onesignal.com/notifications'
        and q.body is not null
        and (
          pg_catalog.convert_from(q.body,'UTF8')::jsonb
          ->> 'app_id'
        )=previous_app_id;

      -- A healthy VisionFood OneSignal request uses a 5 second pg_net timeout.
      -- Keep a further 10 second margin for worker bookkeeping/commit. Once the
      -- exact worker has exceeded that request-specific window, treat it as
      -- broken work rather than blocking emergency credential rotation forever.
      if pg_catalog.clock_timestamp()
           < worker_xact_start
             + pg_catalog.make_interval(
                 secs=>(
                   greatest(in_flight_timeout_ms,5000)+10000
                 )::double precision/1000.0
               ) then
        return jsonb_build_object('ok',false,'reason','config_busy');
      end if;
    end if;
  end if;

  has_key:=
    sid is not null
    and exists(
      select 1
      from vault.secrets s
      where s.id=sid
    );

  if app<>''
     and app is distinct from coalesce(c.app_id,'')
     and key='' then
    return jsonb_build_object(
      'ok',false,
      'reason','api_key_required_for_app_change'
    );
  end if;

  if app<>''
     and key=''
     and not has_key then
    return jsonb_build_object(
      'ok',false,
      'reason','api_key_required'
    );
  end if;

  if key<>'' then
    if has_key then
      perform vault.update_secret(
        sid,key,null,null,null
      );
    else
      sid:=vault.create_secret(
        key,
        'onesignal_api_key::global',
        'OneSignal App API Key',
        null
      );
    end if;

    has_key:=true;
  end if;

  insert into private.onesignal_settings(
    id,
    app_id,
    api_key_secret_id,
    updated_at
  )
  values(
    'global',
    app,
    sid,
    now()
  )
  on conflict(id) do update
    set app_id=excluded.app_id,
        api_key_secret_id=excluded.api_key_secret_id,
        updated_at=now();

  if app is distinct from previous_app_id then
    delete from private.onesignal_admin_push_subscriptions s
    where s.app_id is distinct from app;
  end if;

  return jsonb_build_object(
    'ok',true,
    'app_id',app,
    'has_api_key',has_key
  );
end
$$;

revoke all on function public.set_onesignal_config(text,text)
  from public,anon,authenticated;

grant execute on function public.set_onesignal_config(text,text)
  to service_role;
