alter table private.onesignal_admin_push_subscriptions
  add column if not exists client_instance_id uuid;

-- Rows created by the first registry contract have no durable browser identity.
-- They cannot be safely reconciled after subscription rotation, so invalidate
-- them once and let active authenticated admin browsers register again.
delete from private.onesignal_admin_push_subscriptions
where client_instance_id is null;

alter table private.onesignal_admin_push_subscriptions
  alter column client_instance_id set not null;

create unique index if not exists onesignal_admin_push_subscriptions_client_uidx
  on private.onesignal_admin_push_subscriptions(client_instance_id);

-- Fail closed for cached clients that still use the pre-lifecycle contract.
-- Their rows cannot satisfy the durable browser-instance invariant.
create or replace function public.visionfood_register_admin_push_subscription(
  _org uuid,
  _subscription_id text
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

  if _org is null or not private.usuario_dono_org(_org,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  return jsonb_build_object(
    'ok',false,
    'reason','client_instance_required'
  );
end
$$;

revoke all on function public.visionfood_register_admin_push_subscription(uuid,text)
  from public,anon;

grant execute on function public.visionfood_register_admin_push_subscription(uuid,text)
  to authenticated;

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
  sid text:=btrim(coalesce(_subscription_id,''));
  cid uuid:=_client_instance_id;
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

  -- A browser instance owns at most one current push subscription. Replacing
  -- this row does not collapse other devices because each device has its own
  -- client_instance_id.
  delete from private.onesignal_admin_push_subscriptions s
  where s.client_instance_id=cid
    and s.subscription_id<>sid;

  insert into private.onesignal_admin_push_subscriptions(
    subscription_id,
    client_instance_id,
    organization_id,
    user_id,
    updated_at
  )
  values(
    sid,
    cid,
    _org,
    u,
    pg_catalog.clock_timestamp()
  )
  on conflict (subscription_id)
  do update
    set client_instance_id=excluded.client_instance_id,
        organization_id=excluded.organization_id,
        user_id=excluded.user_id,
        updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true);
end
$$;

revoke all on function public.visionfood_reconcile_admin_push_subscription(uuid,text,uuid)
  from public,anon;

grant execute on function public.visionfood_reconcile_admin_push_subscription(uuid,text,uuid)
  to authenticated;

create or replace function public.visionfood_unregister_admin_push_client(
  _client_instance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  cid uuid:=_client_instance_id;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  if cid is null then
    return jsonb_build_object('ok',false,'reason','invalid_client_instance');
  end if;

  delete from private.onesignal_admin_push_subscriptions s
  where s.client_instance_id=cid
    and u=s.user_id;

  return jsonb_build_object('ok',true);
end
$$;

revoke all on function public.visionfood_unregister_admin_push_client(uuid)
  from public,anon;

grant execute on function public.visionfood_unregister_admin_push_client(uuid)
  to authenticated;

create or replace function private.visionfood_admin_push_subscription_ids(
  _org uuid
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    jsonb_agg(s.subscription_id order by s.subscription_id),
    '[]'::jsonb
  )
  from private.onesignal_admin_push_subscriptions s
  where s.organization_id=_org
    and s.client_instance_id is not null
    and private.usuario_dono_org(_org,s.user_id);
$$;

revoke all on function private.visionfood_admin_push_subscription_ids(uuid)
  from public,anon,authenticated;

grant execute on function private.visionfood_admin_push_subscription_ids(uuid)
  to service_role;
