-- Bind the authoritative admin push registry to the OneSignal App ID that
-- actually created each Subscription ID. App ID rotation must never mix old
-- subscriptions into a notification for the newly configured OneSignal app.

alter table private.onesignal_admin_push_subscriptions
  add column if not exists app_id text;

-- Existing rows predate App ID binding. Their originating app cannot be proven,
-- so fail closed once and let active authenticated admin browsers reconcile.
delete from private.onesignal_admin_push_subscriptions
where app_id is null;

alter table private.onesignal_admin_push_subscriptions
  alter column app_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conname='onesignal_admin_push_subscriptions_app_id_chk'
      and c.conrelid='private.onesignal_admin_push_subscriptions'::regclass
  ) then
    alter table private.onesignal_admin_push_subscriptions
      add constraint onesignal_admin_push_subscriptions_app_id_chk
      check (
        app_id=btrim(app_id)
        and app_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      );
  end if;
end
$$;

create index if not exists onesignal_admin_push_subscriptions_org_app_updated_idx
  on private.onesignal_admin_push_subscriptions(
    organization_id,
    app_id,
    updated_at
  );

-- Cached clients using the pre-App-ID contract must fail closed. Without the
-- SDK App ID the server cannot prove which OneSignal app owns the subscription.
create or replace function public.visionfood_reconcile_admin_push_subscription(
  _org uuid,
  _subscription_id text,
  _client_instance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  if _org is null or not public.usuario_dono_org(_org,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  return jsonb_build_object('ok',false,'reason','app_id_required');
end
$$;

revoke all on function public.visionfood_reconcile_admin_push_subscription(uuid,text,uuid)
  from public,anon;

grant execute on function public.visionfood_reconcile_admin_push_subscription(uuid,text,uuid)
  to authenticated;

create or replace function public.visionfood_reconcile_admin_push_subscription(
  _org uuid,
  _subscription_id text,
  _client_instance_id uuid,
  _app_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  sid text:=btrim(coalesce(_subscription_id,''));
  cid uuid:=_client_instance_id;
  app text:=btrim(coalesce(_app_id,''));
  configured_app_id text;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  if _org is null or not public.usuario_dono_org(_org,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if sid='' or length(sid)>255 then
    return jsonb_build_object('ok',false,'reason','invalid_subscription');
  end if;

  if cid is null then
    return jsonb_build_object('ok',false,'reason','invalid_client_instance');
  end if;

  if app=''
     or app !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok',false,'reason','invalid_app_id');
  end if;

  -- Keep this share lock until the RPC transaction ends. App ID rotation uses
  -- FOR UPDATE on the same row, so rotation cannot cross this reconciliation.
  select btrim(coalesce(c.app_id,''))
    into configured_app_id
  from private.onesignal_settings c
  where c.id='global'
  for share;

  if coalesce(configured_app_id,'')='' then
    return jsonb_build_object('ok',false,'reason','not_configured');
  end if;

  if app<>configured_app_id then
    return jsonb_build_object('ok',false,'reason','app_id_mismatch');
  end if;

  delete from private.onesignal_admin_push_subscriptions s
  where s.client_instance_id=cid
    and (
      s.subscription_id<>sid
      or s.app_id<>app
    );

  insert into private.onesignal_admin_push_subscriptions(
    subscription_id,
    client_instance_id,
    organization_id,
    user_id,
    app_id,
    updated_at
  )
  values(
    sid,
    cid,
    _org,
    u,
    app,
    pg_catalog.clock_timestamp()
  )
  on conflict (subscription_id)
  do update
    set client_instance_id=excluded.client_instance_id,
        organization_id=excluded.organization_id,
        user_id=excluded.user_id,
        app_id=excluded.app_id,
        updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true);
end
$$;

revoke all on function public.visionfood_reconcile_admin_push_subscription(uuid,text,uuid,text)
  from public,anon;

grant execute on function public.visionfood_reconcile_admin_push_subscription(uuid,text,uuid,text)
  to authenticated;

create or replace function private.visionfood_admin_push_subscription_ids(
  _org uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  configured_app_id text;
  subscription_ids jsonb;
begin
  -- Keep the OneSignal configuration stable for the rest of the outer
  -- transaction. The subsequent queue call therefore cannot switch app IDs
  -- after this audience has been selected.
  select btrim(coalesce(c.app_id,''))
    into configured_app_id
  from private.onesignal_settings c
  where c.id='global'
  for share;

  if coalesce(configured_app_id,'')='' then
    delete from private.onesignal_admin_push_subscriptions s
    where s.organization_id=_org;

    return '[]'::jsonb;
  end if;

  -- Remove expired or old-App bindings without waiting for those browsers to
  -- return. This also bounds any debris left by prior App ID rotations.
  delete from private.onesignal_admin_push_subscriptions s
  where s.organization_id=_org
    and (
      s.updated_at <= pg_catalog.clock_timestamp() - interval '30 days'
      or s.app_id is distinct from configured_app_id
    );

  select coalesce(
    jsonb_agg(s.subscription_id order by s.subscription_id),
    '[]'::jsonb
  )
    into subscription_ids
  from private.onesignal_admin_push_subscriptions s
  where s.organization_id=_org
    and s.client_instance_id is not null
    and s.app_id=configured_app_id
    and s.updated_at > pg_catalog.clock_timestamp() - interval '30 days'
    and public.usuario_dono_org(_org,s.user_id);

  return subscription_ids;
end
$$;

revoke all on function private.visionfood_admin_push_subscription_ids(uuid)
  from public,anon,authenticated;

grant execute on function private.visionfood_admin_push_subscription_ids(uuid)
  to service_role;

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
  u uuid:=auth.uid();
  c private.onesignal_settings%rowtype;
  sid uuid;
  app text:=btrim(coalesce(_app_id,''));
  key text:=btrim(coalesce(_api_key,''));
  previous_app_id text:='';
  has_key boolean:=false;
begin
  if u is null or not public.eh_super_admin(u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if app<>'' and app !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok',false,'reason','invalid_app_id');
  end if;

  if key<>'' and (length(key)<20 or length(key)>1000) then
    return jsonb_build_object('ok',false,'reason','invalid_api_key');
  end if;

  select * into c
  from private.onesignal_settings
  where id='global'
  for update;

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
  from public,anon;

grant execute on function public.set_onesignal_config(text,text)
  to authenticated,service_role;
