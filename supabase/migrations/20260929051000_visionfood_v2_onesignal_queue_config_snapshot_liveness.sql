-- Avoid retaining a configuration row lock through the outer caller
-- transaction while preserving an atomic OneSignal App ID/API key snapshot.
--
-- PostgreSQL READ COMMITTED uses one MVCC snapshot per statement. Reading the
-- settings row and decrypted Vault secret in the same SELECT therefore sees
-- either the pre-rotation pair or the post-rotation pair, never a mixed pair.
-- This removes the need for visionfood_onesignal_queue itself to hold FOR SHARE
-- until the surrounding delivery/rupture transaction commits.
--
-- pg_net remains asynchronous: net.http_post only queues the request locally;
-- the network request is processed after commit. Predictive/admin audience
-- locking remains unchanged and continues to protect its own registry TOCTOU.

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
begin
  -- One SQL statement = one MVCC snapshot. set_onesignal_config changes the
  -- Vault secret and settings row in one transaction, so this JOIN observes a
  -- transaction-consistent credential pair without a transaction-scoped row
  -- lock on private.onesignal_settings.
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
