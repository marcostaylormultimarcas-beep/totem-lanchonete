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
-- Ownership and liveness are classified in one SQL statement. That keeps q.xmax,
-- the matching backend_xid/xact_start and the row's own timeout_milliseconds in
-- one command snapshot, so a pg_net commit/abort/restart cannot make the function
-- resolve one owner and then calculate the window from a later owner state.
-- Every remaining old-generation row is evaluated independently; any unknown
-- owner or any genuine pg_net owner still inside its bounded window keeps the
-- rotation config_busy.
--
-- The function runs with stats_fetch_consistency=none so pg_stat_activity is not
-- inherited from an earlier cached monitoring snapshot in the caller transaction.
-- PostgreSQL restores the caller setting when the function exits.

create or replace function public.set_onesignal_config(
  _app_id text,
  _api_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
set stats_fetch_consistency='none'
as $
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
  remaining_old_requests bigint:=0;
  has_unowned_old_request boolean:=false;
  has_live_old_request boolean:=false;
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

    -- Classify all rows that remain visible after cleanup in one statement.
    -- q.xmax, the exact pg_net backend_xid/xact_start and q.timeout_milliseconds
    -- therefore belong to the same command snapshot instead of three successive
    -- snapshots that can observe different worker ownership.
    select
      pg_catalog.count(*),
      coalesce(
        pg_catalog.bool_or(
          a.backend_xid is null
          or a.xact_start is null
        ),
        false
      ),
      coalesce(
        pg_catalog.bool_or(
          a.backend_xid is not null
          and a.xact_start is not null
          and pg_catalog.statement_timestamp()
                < a.xact_start
                  + pg_catalog.make_interval(
                      secs=>(
                        greatest(
                          coalesce(q.timeout_milliseconds,5000),
                          5000
                        )+10000
                      )::double precision/1000.0
                    )
        ),
        false
      )
      into
        remaining_old_requests,
        has_unowned_old_request,
        has_live_old_request
    from net.http_request_queue q
    left join pg_catalog.pg_stat_activity a
      on a.datname=pg_catalog.current_database()
     and a.backend_type ilike '%pg_net%'
     and a.backend_xid=q.xmax
    where q.method='POST'
      and q.url='https://api.onesignal.com/notifications'
      and q.body is not null
      and (
        pg_catalog.convert_from(q.body,'UTF8')::jsonb
        ->> 'app_id'
      )=previous_app_id;

    -- A row with no exact pg_net owner is still potentially sendable after its
    -- current locker releases it, so remain fail-closed. For exact pg_net owners,
    -- any request still inside its own timeout + 10 s grace keeps the barrier.
    -- Only when every remaining exact owner has exceeded that bounded window may
    -- emergency rotation proceed.
    if remaining_old_requests>0
       and (
         has_unowned_old_request
         or has_live_old_request
       ) then
      return jsonb_build_object('ok',false,'reason','config_busy');
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
