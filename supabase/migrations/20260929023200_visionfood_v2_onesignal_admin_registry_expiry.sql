create index if not exists onesignal_admin_push_subscriptions_org_updated_idx
  on private.onesignal_admin_push_subscriptions(organization_id, updated_at);

create or replace function private.visionfood_admin_push_subscription_ids(
  _org uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  subscription_ids jsonb;
begin
  -- A browser can disappear without ever completing unregister/optOut.
  -- Expire orphaned authoritative bindings server-side instead of relying
  -- on that browser to return and reconcile itself.
  delete from private.onesignal_admin_push_subscriptions s
  where s.organization_id=_org
    and s.updated_at <= pg_catalog.clock_timestamp() - interval '30 days';

  select coalesce(
    jsonb_agg(s.subscription_id order by s.subscription_id),
    '[]'::jsonb
  )
    into subscription_ids
  from private.onesignal_admin_push_subscriptions s
  where s.organization_id=_org
    and s.client_instance_id is not null
    and s.updated_at > pg_catalog.clock_timestamp() - interval '30 days'
    and public.usuario_dono_org(_org,s.user_id);

  return subscription_ids;
end
$$;

revoke all on function private.visionfood_admin_push_subscription_ids(uuid)
  from public,anon,authenticated;

grant execute on function private.visionfood_admin_push_subscription_ids(uuid)
  to service_role;
