-- Bound the committed-request cutover barrier so an orphaned/stalled pg_net
-- request cannot make OneSignal credential rotation permanently unavailable.
--
-- Normal safety is preserved:
--   * configuration rotation still owns the settings row and exclusive
--     generation advisory guard before touching the queue;
--   * old-generation requests that are still merely queued are cancelled under
--     FOR UPDATE SKIP LOCKED, so they cannot wake later with revoked credentials;
--   * a request already claimed by the pg_net worker remains visible by MVCC
--     while the worker transaction is in flight, and recent in-flight work still
--     returns config_busy.
--
-- Liveness is bounded without depending on a queue timestamp column (pg_net's
-- http_request_queue does not provide one). For a row that remains after the
-- SKIP LOCKED cleanup, use the pg_net worker transaction start plus that row's
-- own timeout_milliseconds, with a 10 second worker/commit grace. Once that
-- bounded window is exceeded (or no pg_net worker transaction exists), rotation
-- is allowed to proceed rather than being blocked indefinitely by broken work.

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

    -- Anything still visible after the SKIP LOCKED delete is currently owned
    -- by another transaction. In the normal pg_net path this is the worker's
    -- DELETE ... RETURNING transaction around the HTTP attempt.
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
      select pg_catalog.min(a.xact_start)
        into worker_xact_start
      from pg_catalog.pg_stat_activity a
      where a.datname=pg_catalog.current_database()
        and a.backend_type ilike '%pg_net%'
        and a.xact_start is not null;

      select coalesce(pg_catalog.max(q.timeout_milliseconds),0)
        into in_flight_timeout_ms
      from net.http_request_queue q
      where q.method='POST'
        and q.url='https://api.onesignal.com/notifications'
        and q.body is not null
        and (
          pg_catalog.convert_from(q.body,'UTF8')::jsonb
          ->> 'app_id'
        )=previous_app_id;

      -- A healthy VisionFood OneSignal request uses a 5 second pg_net timeout.
      -- Keep a further 10 second margin for worker bookkeeping/commit. Only a
      -- recent worker transaction may block rotation. A stopped worker, orphan
      -- row, or worker transaction that has exceeded the request timeout plus
      -- this grace cannot hold the credential cutover forever.
      if worker_xact_start is not null
         and pg_catalog.clock_timestamp()
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
