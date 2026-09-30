-- Prevent a pg_net request that already committed under the old OneSignal
-- credential generation from being overtaken by a successful configuration
-- cutover before the background worker actually transmits it.
--
-- pg_net processes a batch by DELETE ... RETURNING from http_request_queue,
-- performs the curl requests, stores responses, and only then commits the
-- worker transaction. Therefore an old request remains visible to concurrent
-- transactions in net.http_request_queue for the whole queued/in-flight
-- interval. Once it is no longer visible, that worker transaction (including
-- the HTTP attempt) has completed.
--
-- The existing advisory generation guard still closes the other side of the
-- race: after rotation acquires it exclusively, no new queue caller can commit
-- another request from the old generation.

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
begin
  if app<>'' and app !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok',false,'reason','invalid_app_id');
  end if;

  if key<>'' and (length(key)<20 or length(key)>1000) then
    return jsonb_build_object('ok',false,'reason','invalid_api_key');
  end if;

  -- Preserve the established config -> queue lock order. Predictive/admin
  -- callers may already hold FOR SHARE on this row before they call the queue,
  -- so rotation must not take the advisory guard first.
  select * into c
  from private.onesignal_settings
  where id='global'
  for update;

  -- A direct queue caller does not lock the settings row. If one captured the
  -- old credential generation first, fail this rotation immediately rather
  -- than allowing a successful cutover to overtake that transaction.
  if not pg_catalog.pg_try_advisory_xact_lock(config_guard) then
    return jsonb_build_object('ok',false,'reason','config_busy');
  end if;

  previous_app_id:=btrim(coalesce(c.app_id,''));
  sid:=c.api_key_secret_id;
  changes_generation:=
    app is distinct from previous_app_id
    or key<>'';

  -- The advisory guard only covers queue transactions that have not committed
  -- yet. A request committed earlier has already released that guard but may
  -- still be queued or in-flight inside pg_net. The pg_net worker deletes its
  -- queue rows and performs curl in one transaction, committing only after the
  -- response attempt finishes, so the old row remains visible throughout that
  -- interval. Do not publish/revoke the old generation until it drains.
  if changes_generation
     and previous_app_id<>''
     and exists(
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
    return jsonb_build_object('ok',false,'reason','config_busy');
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
