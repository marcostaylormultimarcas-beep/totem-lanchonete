-- Keep the OneSignal App ID and App API Key as one transaction-stable
-- credential snapshot while queueing a notification.
--
-- set_onesignal_config locks this singleton row FOR UPDATE before it may
-- update the Vault secret in place. Without a conflicting lock here, the
-- queue could read the old app_id, then observe the newly committed secret
-- value in vault.decrypted_secrets and send an inconsistent credential pair.
--
-- The row lock is held through net.http_post by the outer transaction. This
-- protects direct delivery/rupture trigger callers as well as predictive push
-- callers that already lock configuration earlier in their flow.

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
  c private.onesignal_settings%rowtype;
  api_key text;
  body jsonb;
  request_id bigint;
begin
  -- Serialize this credential snapshot with set_onesignal_config. If queueing
  -- wins the lock, rotation cannot update the Vault secret until this enqueue
  -- transaction ends. If rotation wins, this read waits and then sees the new
  -- App ID before reading the new secret.
  select * into c
  from private.onesignal_settings
  where id='global'
  for share;

  if not found
     or nullif(btrim(coalesce(c.app_id,'')),'') is null
     or c.api_key_secret_id is null then
    return null;
  end if;

  select ds.decrypted_secret
    into api_key
  from vault.decrypted_secrets ds
  where ds.id=c.api_key_secret_id
  limit 1;

  if nullif(btrim(coalesce(api_key,'')),'') is null then
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
    'app_id',c.app_id,
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
