-- Replace the table-wide SHARE ROW EXCLUSIVE guard with row-level
-- locking of the exact authoritative audience. This keeps the
-- audience-read -> enqueue interval stable without serializing unrelated
-- organizations or concurrent pushes whose audiences do not overlap.
--
-- Lock order remains configuration first, then registry rows. Reconcile
-- pre-locks every existing registry row it may mutate in subscription_id
-- order so it cannot deadlock with the audience reader while rotating a
-- client/subscription binding.

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
  -- App ID rotation uses FOR UPDATE on this same row, so configuration stays
  -- stable through the outer push/enqueue transaction.
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

  -- Cleanup touches only rows that cannot be selected into the current
  -- audience. It intentionally happens before the audience row locks.
  delete from private.onesignal_admin_push_subscriptions s
  where s.organization_id=_org
    and (
      s.updated_at <= pg_catalog.clock_timestamp() - interval '30 days'
      or s.app_id is distinct from configured_app_id
    );

  -- FOR SHARE blocks UPDATE/DELETE of the exact rows selected into
  -- include_subscription_ids until the caller transaction ends, while the
  -- table-level ROW SHARE lock remains compatible with unrelated DML.
  select coalesce(
    jsonb_agg(locked.subscription_id order by locked.subscription_id),
    '[]'::jsonb
  )
    into subscription_ids
  from (
    select s.subscription_id
    from private.onesignal_admin_push_subscriptions s
    where s.organization_id=_org
      and s.client_instance_id is not null
      and s.app_id=configured_app_id
      and s.updated_at > pg_catalog.clock_timestamp() - interval '30 days'
      and private.usuario_dono_org(_org,s.user_id)
    order by s.subscription_id
    for share of s
  ) locked;

  return subscription_ids;
end
$$;

revoke all on function private.visionfood_admin_push_subscription_ids(uuid)
  from public,anon,authenticated;

grant execute on function private.visionfood_admin_push_subscription_ids(uuid)
  to service_role;

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

  if _org is null or not private.usuario_dono_org(_org,u) then
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

  -- Keep App ID rotation outside this reconciliation.
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

  -- Reconcile may delete the current client row and then update a second row
  -- through ON CONFLICT(subscription_id). Lock both possible existing rows in
  -- one canonical order before either mutation. Audience readers use the same
  -- subscription_id order with FOR SHARE, preventing A<->B lock inversion.
  perform 1
  from private.onesignal_admin_push_subscriptions s
  where s.client_instance_id=cid
     or s.subscription_id=sid
  order by s.subscription_id
  for update;

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
