-- OneSignal Durable Outbox V2 - phase 2.
--
-- Link the singleton live settings row to an immutable credential generation.
-- The live delivery/rupture/predictive path is intentionally unchanged:
-- visionfood_onesignal_queue remains the transport entrypoint and all legacy
-- cutover/liveness guards stay active until producers are moved to the outbox.
--
-- Rotation no longer mutates the Vault secret used by the previous generation.
-- A supplied API key creates a brand-new Vault secret and a brand-new generation;
-- settings then atomically points future legacy queue calls at that generation.

alter table private.onesignal_settings
  add column if not exists config_generation_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conname='onesignal_config_generations_id_app_secret_key'
      and c.conrelid='private.onesignal_config_generations'::pg_catalog.regclass
  ) then
    alter table private.onesignal_config_generations
      add constraint onesignal_config_generations_id_app_secret_key
      unique (id,app_id,api_key_secret_id);
  end if;
end
$$;

-- Seed the currently configured App ID + Vault secret as generation zero for
-- the durable model. The existing Vault row is referenced, not copied or
-- updated, so its identity and ciphertext remain untouched.
do $$
declare
  current_app_id text;
  current_secret_id uuid;
  seeded_generation_id uuid;
begin
  select s.app_id, s.api_key_secret_id
    into current_app_id, current_secret_id
  from private.onesignal_settings s
  where s.id='global'
  for update;

  if found
     and nullif(btrim(coalesce(current_app_id,'')),'') is not null
     and current_secret_id is not null
     and exists(
       select 1
       from vault.secrets vs
       where vs.id=current_secret_id
     ) then
    select g.id
      into seeded_generation_id
    from private.onesignal_config_generations g
    where g.app_id=current_app_id
      and g.api_key_secret_id=current_secret_id
    order by g.created_at asc
    limit 1;

    if seeded_generation_id is null then
      insert into private.onesignal_config_generations(
        app_id,
        api_key_secret_id
      )
      values(
        current_app_id,
        current_secret_id
      )
      returning id into seeded_generation_id;
    end if;

    update private.onesignal_settings
       set config_generation_id=seeded_generation_id
     where id='global';
  elsif found then
    update private.onesignal_settings
       set config_generation_id=null
     where id='global';
  end if;
end
$$;

-- The pointer and the duplicated legacy fields must refer to the same immutable
-- generation. Keeping app_id/api_key_secret_id on settings preserves all legacy
-- readers while the outbox rollout is still incremental.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conname='onesignal_settings_generation_fk'
      and c.conrelid='private.onesignal_settings'::pg_catalog.regclass
  ) then
    alter table private.onesignal_settings
      add constraint onesignal_settings_generation_fk
      foreign key (
        config_generation_id,
        app_id,
        api_key_secret_id
      )
      references private.onesignal_config_generations(
        id,
        app_id,
        api_key_secret_id
      )
      on delete restrict;
  end if;
end
$$;

-- Generations are snapshots. Retention may delete an old generation only after
-- it is no longer referenced, but no caller may rewrite a generation in place.
create or replace function private.visionfood_reject_onesignal_generation_update()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'onesignal_config_generation_immutable'
    using errcode='55000';
end
$$;

revoke all
  on function private.visionfood_reject_onesignal_generation_update()
  from public,anon,authenticated;

drop trigger if exists trg_onesignal_config_generations_immutable
  on private.onesignal_config_generations;

create trigger trg_onesignal_config_generations_immutable
before update on private.onesignal_config_generations
for each row
execute function private.visionfood_reject_onesignal_generation_update();

revoke update
  on table private.onesignal_config_generations
  from service_role;

create or replace function public.set_onesignal_config(
  _app_id text,
  _api_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
set stats_fetch_consistency='none'
as $$
declare
  c private.onesignal_settings%rowtype;
  sid uuid;
  generation_id uuid;
  app text:=btrim(coalesce(_app_id,''));
  key text:=btrim(coalesce(_api_key,''));
  previous_app_id text:='';
  has_key boolean:=false;
  config_guard bigint:=pg_catalog.hashtextextended(
    'visionfood:onesignal_config',
    0
  );
  changes_generation boolean:=false;
  remaining_old_requests bigint:=0;
  has_unowned_old_request boolean:=false;
  has_live_old_request boolean:=false;
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

  -- Preserve the established config -> queue lock order.
  select * into c
  from private.onesignal_settings
  where id='global'
  for update;

  -- A direct queue caller that has not committed yet owns the matching shared
  -- generation guard. Never wait behind it while the settings row is locked.
  if not pg_catalog.pg_try_advisory_xact_lock(config_guard) then
    return jsonb_build_object('ok',false,'reason','config_busy');
  end if;

  previous_app_id:=btrim(coalesce(c.app_id,''));
  sid:=c.api_key_secret_id;
  generation_id:=c.config_generation_id;
  changes_generation:=
    app is distinct from previous_app_id
    or key<>'';

  if changes_generation and previous_app_id<>'' then
    -- Legacy cutover guard remains authoritative while any producer still
    -- submits directly through visionfood_onesignal_queue/pg_net.
    with cancellable as (
      select q.id
      from net.http_request_queue q
      where q.method='POST'
        and q.url='https://api.onesignal.com/notifications'
        and q.body is not null
        and (
          pg_catalog.convert_from(q.body,'UTF8')::jsonb
          ->> 'app_id'
        )=previous_app_id
      for update skip locked
    )
    delete from net.http_request_queue q
    using cancellable cdr
    where q.id=cdr.id;

    select
      pg_catalog.count(*),
      coalesce(
        pg_catalog.bool_or(
          a.backend_xid is null
          or a.xact_start is null
        ),
        false
      ),
      coalesce(
        pg_catalog.bool_or(
          a.backend_xid is not null
          and a.xact_start is not null
          and pg_catalog.statement_timestamp()
                < a.xact_start
                  + pg_catalog.make_interval(
                      secs=>(
                        greatest(
                          coalesce(q.timeout_milliseconds,5000),
                          5000
                        )+10000
                      )::double precision/1000.0
                    )
        ),
        false
      )
      into
        remaining_old_requests,
        has_unowned_old_request,
        has_live_old_request
    from net.http_request_queue q
    left join pg_catalog.pg_stat_activity a
      on a.datname=pg_catalog.current_database()
     and a.backend_type ilike '%pg_net%'
     and a.backend_xid=q.xmax
    where q.method='POST'
      and q.url='https://api.onesignal.com/notifications'
      and q.body is not null
      and (
        pg_catalog.convert_from(q.body,'UTF8')::jsonb
        ->> 'app_id'
      )=previous_app_id;

    if remaining_old_requests>0
       and (
         has_unowned_old_request
         or has_live_old_request
       ) then
      return jsonb_build_object('ok',false,'reason','config_busy');
    end if;
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

    -- Never update the previous secret in place. The generation UUID is also
    -- embedded in the Vault name so every rotation has a distinct secret row.
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
    -- Disabled configuration has no active generation. The historical
    -- generation and Vault secret remain intact for durable old references.
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
