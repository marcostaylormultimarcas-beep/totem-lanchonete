-- OneSignal Durable Outbox V2 - phase 7.
--
-- Predictive, delivery and rupture are now fully migrated to the durable
-- outbox. Retire the direct legacy transport path and remove the old pg_net
-- cutover/liveness guards from configuration rotation.
--
-- Historical migrations remain untouched/replayable. The public legacy queue
-- signature is preserved as an inert compatibility symbol so old prepared SQL
-- or schema introspection does not fail on function lookup, but it can no
-- longer submit HTTP requests or read live OneSignal credentials.
--
-- The durable model no longer needs rotation to inspect net.http_request_queue
-- or pg_stat_activity: each logical push freezes config_generation_id, app_id,
-- payload, audience and idempotency key, and each generation keeps its own
-- immutable Vault secret. pg_net remains only the asynchronous transport used
-- by the durable dispatcher/reconciler.

-- The predecessor config function explicitly opted out of cached stats while
-- it inspected pg_stat_activity. That dependency is gone in phase 7.
alter function public.set_onesignal_config(text,text)
  reset stats_fetch_consistency;

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
begin
  -- Compatibility-only tombstone. All supported producers use the durable
  -- outbox and this legacy entrypoint must never bypass it.
  return null;
end
$$;

revoke all on function public.visionfood_onesignal_queue(jsonb,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;

comment on function public.visionfood_onesignal_queue(jsonb,jsonb,jsonb,jsonb)
  is 'Retired in Durable Outbox V2 phase 7; compatibility signature only, no transport side effects.';

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
  generation_id uuid;
  app text:=btrim(coalesce(_app_id,''));
  key text:=btrim(coalesce(_api_key,''));
  previous_app_id text:='';
  has_key boolean:=false;
begin
  if app<>'' and app !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok',false,'reason','invalid_app_id');
  end if;

  if key<>'' and (length(key)<20 or length(key)>1000) then
    return jsonb_build_object('ok',false,'reason','invalid_api_key');
  end if;

  if app='' and key<>'' then
    return jsonb_build_object(
      'ok',false,
      'reason','app_id_required_for_api_key'
    );
  end if;

  -- Serialize only writers of the live configuration pointer. Durable pushes
  -- already hold an immutable generation reference and do not participate in
  -- this lock or block a new generation from becoming current.
  select * into c
  from private.onesignal_settings
  where id='global'
  for update;

  previous_app_id:=btrim(coalesce(c.app_id,''));
  sid:=c.api_key_secret_id;
  generation_id:=c.config_generation_id;

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

  if app<>''
     and key=''
     and not exists(
       select 1
       from private.onesignal_config_generations g
       where g.id=generation_id
         and g.app_id=app
         and g.api_key_secret_id=sid
     ) then
    return jsonb_build_object(
      'ok',false,
      'reason','config_generation_missing'
    );
  end if;

  if key<>'' then
    generation_id:=gen_random_uuid();

    -- Rotation creates a new Vault row and immutable generation. Older outbox
    -- rows keep referencing their original generation/secret and can finish or
    -- retry without consulting the live settings pointer.
    sid:=vault.create_secret(
      key,
      'onesignal_api_key::global::'||generation_id::text,
      'OneSignal App API Key generation '||generation_id::text,
      null
    );

    insert into private.onesignal_config_generations(
      id,
      app_id,
      api_key_secret_id
    )
    values(
      generation_id,
      app,
      sid
    );

    has_key:=true;
  elsif app='' then
    -- Disabling only clears the live pointer. Historical generations/secrets
    -- remain available to already-frozen durable attempts.
    generation_id:=null;
    sid:=null;
    has_key:=false;
  end if;

  insert into private.onesignal_settings(
    id,
    app_id,
    api_key_secret_id,
    config_generation_id,
    updated_at
  )
  values(
    'global',
    app,
    sid,
    generation_id,
    now()
  )
  on conflict(id) do update
    set app_id=excluded.app_id,
        api_key_secret_id=excluded.api_key_secret_id,
        config_generation_id=excluded.config_generation_id,
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
