-- Serialize the authoritative admin-subscription snapshot with every registry
-- INSERT/UPDATE/DELETE until the caller transaction ends. Predictive push
-- selection and net.http_post therefore share one linearization point: a
-- reconcile, unregister or organization move is either fully visible before
-- the audience is selected or waits until that enqueue transaction commits.
--
-- Lock ordering is intentional. The OneSignal configuration row is locked
-- first, matching reconcile/set_onesignal_config, then the registry table is
-- locked. This avoids config<->registry lock inversion during App ID rotation.

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
  -- Configuration remains stable through the outer caller transaction.
  -- set_onesignal_config uses FOR UPDATE on this same row.
  select btrim(coalesce(c.app_id,''))
    into configured_app_id
  from private.onesignal_settings c
  where c.id='global'
  for share;

  -- SHARE ROW EXCLUSIVE conflicts with the ROW EXCLUSIVE lock automatically
  -- taken by INSERT/UPDATE/DELETE. Because table locks are transaction-scoped,
  -- registry mutations cannot cross the audience-read -> enqueue interval.
  --
  -- This stronger mode also serializes concurrent callers of this helper,
  -- avoiding lock-upgrade deadlocks when the cleanup below needs to DELETE.
  lock table private.onesignal_admin_push_subscriptions
    in share row exclusive mode;

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
