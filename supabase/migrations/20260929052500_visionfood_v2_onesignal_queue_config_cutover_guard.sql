-- Prevent a pre-rotation OneSignal credential snapshot from crossing a
-- successful configuration cutover while keeping direct queue callers from
-- blocking rotation indefinitely.
--
-- The queue uses a transaction-scoped shared advisory generation guard. This
-- intentionally lives until the outer caller commits because pg_net requests
-- are only made visible after that commit.
--
-- Configuration rotation keeps the existing lock order used by administrative
-- and predictive paths: settings row first, generation guard second. Once the
-- row is locked FOR UPDATE, it tries the exclusive generation guard. If an
-- older direct delivery/rupture queue transaction still owns the shared guard,
-- rotation returns config_busy immediately instead of waiting behind it.
--
-- This preserves the previous liveness fix: visionfood_onesignal_queue does
-- not take a row lock on private.onesignal_settings.

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

create or replace function public.visionfood_onesignal_queue(
  _target jsonb,
  _headings jsonb,
  _contents jsonb,
  _data jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  app_id text;
  api_key text;
  body jsonb;
  request_id bigint;
  config_guard bigint:=pg_catalog.hashtextextended(
    'visionfood:onesignal_config',
    0
  );
begin
  -- Hold the credential generation stable until the outer transaction commits.
  -- A rotation that reaches its generation check uses the matching try-lock and
  -- returns config_busy instead of waiting behind this direct queue caller.
  perform pg_catalog.pg_advisory_xact_lock_shared(config_guard);

  -- One SQL statement = one MVCC snapshot. The advisory guard additionally
  -- prevents a successful rotation from overtaking this old-but-consistent
  -- snapshot before its pg_net request becomes transactionally visible.
  select c.app_id, ds.decrypted_secret
    into app_id, api_key
  from private.onesignal_settings c
  left join vault.decrypted_secrets ds
    on ds.id=c.api_key_secret_id
  where c.id='global'
  limit 1;

  if not found
     or nullif(btrim(coalesce(app_id,'')),'') is null
     or nullif(btrim(coalesce(api_key,'')),'') is null then
    return null;
  end if;

  if _target is null
     or jsonb_typeof(_target)<>'object'
     or _headings is null
     or jsonb_typeof(_headings)<>'object'
     or _contents is null
     or jsonb_typeof(_contents)<>'object' then
    return null;
  end if;

  body:=jsonb_build_object(
    'app_id',app_id,
    'target_channel','push',
    'headings',_headings,
    'contents',_contents,
    'data',coalesce(_data,'{}'::jsonb)
  ) || _target;

  select net.http_post(
    url:='https://api.onesignal.com/notifications',
    body:=body,
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Key '||api_key
    ),
    timeout_milliseconds:=5000
  )
  into request_id;

  return request_id;
end
$$;

revoke all on function public.visionfood_onesignal_queue(jsonb,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
