-- OneSignal Durable Outbox V2 - phase 3.
--
-- Durable runtime primitives for enqueue -> claim -> dispatch -> reconcile -> retry.
-- No producer is migrated in this phase: delivery, rupture and predictive keep
-- using the legacy queue. pg_net is used only as asynchronous HTTP transport.

-- Frozen logical-request fields must never change across retries.
create or replace function private.visionfood_guard_onesignal_outbox_frozen_update()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.push_type is distinct from old.push_type
     or new.source_kind is distinct from old.source_kind
     or new.source_key is distinct from old.source_key
     or new.config_generation_id is distinct from old.config_generation_id
     or new.app_id is distinct from old.app_id
     or new.audience is distinct from old.audience
     or new.payload is distinct from old.payload
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception 'onesignal_outbox_frozen_request_immutable'
      using errcode='55000';
  end if;

  return new;
end
$$;

revoke all on function private.visionfood_guard_onesignal_outbox_frozen_update()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_onesignal_outbox_frozen_update
  on private.onesignal_outbox;

create trigger trg_onesignal_outbox_frozen_update
before update on private.onesignal_outbox
for each row
execute function private.visionfood_guard_onesignal_outbox_frozen_update();

-- Attempt identity is immutable. Reconciliation may fill the result exactly
-- once; after result_observed_at is set, the attempt row cannot be rewritten.
create or replace function private.visionfood_guard_onesignal_outbox_attempt_update()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.id is distinct from old.id
     or new.outbox_id is distinct from old.outbox_id
     or new.attempt_no is distinct from old.attempt_no
     or new.lease_token is distinct from old.lease_token
     or new.pg_net_request_id is distinct from old.pg_net_request_id
     or new.created_at is distinct from old.created_at
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'onesignal_outbox_attempt_identity_immutable'
      using errcode='55000';
  end if;

  if old.result_observed_at is not null then
    raise exception 'onesignal_outbox_attempt_result_immutable'
      using errcode='55000';
  end if;

  if new.result_observed_at is null
     or new.semantic_outcome is null then
    raise exception 'onesignal_outbox_attempt_result_must_finalize_once'
      using errcode='23514';
  end if;

  return new;
end
$$;

revoke all on function private.visionfood_guard_onesignal_outbox_attempt_update()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_onesignal_outbox_attempt_update
  on private.onesignal_outbox_attempts;

create trigger trg_onesignal_outbox_attempt_update
before update on private.onesignal_outbox_attempts
for each row
execute function private.visionfood_guard_onesignal_outbox_attempt_update();

-- Runtime writes go through SECURITY DEFINER functions below.
revoke insert,update,delete on table private.onesignal_outbox
  from service_role;
revoke insert,update,delete on table private.onesignal_outbox_attempts
  from service_role;
grant select on table private.onesignal_outbox to service_role;
grant select on table private.onesignal_outbox_attempts to service_role;

create index if not exists onesignal_outbox_attempts_unresolved_idx
  on private.onesignal_outbox_attempts(submitted_at,id)
  where result_observed_at is null
    and pg_net_request_id is not null;

-- Enqueue one immutable logical request. The current generation is captured in
-- one MVCC statement; rotation may move settings afterwards without changing
-- this outbox row. Supplying the same idempotency key is itself idempotent only
-- when the caller supplies the exact same logical request.
create or replace function private.visionfood_onesignal_outbox_enqueue(
  _organization_id uuid,
  _push_type text,
  _source_kind text,
  _source_key text,
  _audience jsonb,
  _payload jsonb,
  _idempotency_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  logical_key uuid:=coalesce(_idempotency_key,gen_random_uuid());
  generation_id uuid;
  generation_app_id text;
  frozen_data jsonb;
  frozen_payload jsonb;
  existing private.onesignal_outbox%rowtype;
  created_id uuid;
begin
  if _organization_id is null then
    raise exception 'onesignal_outbox_organization_required'
      using errcode='22023';
  end if;

  if nullif(btrim(coalesce(_push_type,'')),'') is null
     or nullif(btrim(coalesce(_source_kind,'')),'') is null
     or nullif(btrim(coalesce(_source_key,'')),'') is null then
    raise exception 'onesignal_outbox_source_required'
      using errcode='22023';
  end if;

  if _audience is null
     or jsonb_typeof(_audience)<>'object'
     or _audience='{}'::jsonb then
    raise exception 'onesignal_outbox_invalid_audience'
      using errcode='22023';
  end if;

  if _audience ?| array['app_id','idempotency_key','data','target_channel'] then
    raise exception 'onesignal_outbox_reserved_audience_field'
      using errcode='22023';
  end if;

  if _payload is null or jsonb_typeof(_payload)<>'object' then
    raise exception 'onesignal_outbox_invalid_payload'
      using errcode='22023';
  end if;

  frozen_data:=coalesce(_payload->'data','{}'::jsonb);
  if jsonb_typeof(frozen_data)<>'object' then
    raise exception 'onesignal_outbox_invalid_payload_data'
      using errcode='22023';
  end if;

  -- A repeated enqueue with the same key must resolve to the already-frozen
  -- request even if the live OneSignal generation rotated in the meantime.
  select o.*
    into existing
  from private.onesignal_outbox o
  where o.idempotency_key=logical_key;

  if found then
    frozen_payload:=
      (((_payload-'app_id')-'idempotency_key')-'data')
      || _audience
      || jsonb_build_object(
           'app_id',existing.app_id,
           'idempotency_key',logical_key::text,
           'target_channel','push',
           'data',frozen_data || jsonb_build_object(
             'organization_id',_organization_id::text
           )
         );

    if existing.organization_id is distinct from _organization_id
       or existing.push_type is distinct from btrim(_push_type)
       or existing.source_kind is distinct from btrim(_source_kind)
       or existing.source_key is distinct from btrim(_source_key)
       or existing.audience is distinct from _audience
       or existing.payload is distinct from frozen_payload then
      raise exception 'onesignal_outbox_idempotency_conflict'
        using errcode='23505';
    end if;

    return existing.id;
  end if;

  -- Generation + App ID + Vault-secret identity are read atomically from the
  -- phase-2 immutable configuration link. No live secret value is copied here.
  select s.config_generation_id,s.app_id
    into generation_id,generation_app_id
  from private.onesignal_settings s
  join private.onesignal_config_generations g
    on g.id=s.config_generation_id
   and g.app_id=s.app_id
   and g.api_key_secret_id=s.api_key_secret_id
  where s.id='global'
    and nullif(btrim(coalesce(s.app_id,'')),'') is not null
    and s.config_generation_id is not null
  limit 1;

  if not found then
    raise exception 'onesignal_outbox_not_configured'
      using errcode='55000';
  end if;

  frozen_payload:=
    (((_payload-'app_id')-'idempotency_key')-'data')
    || _audience
    || jsonb_build_object(
         'app_id',generation_app_id,
         'idempotency_key',logical_key::text,
         'target_channel','push',
         'data',frozen_data || jsonb_build_object(
           'organization_id',_organization_id::text
         )
       );

  insert into private.onesignal_outbox(
    organization_id,
    push_type,
    source_kind,
    source_key,
    config_generation_id,
    app_id,
    audience,
    payload,
    idempotency_key
  )
  values(
    _organization_id,
    btrim(_push_type),
    btrim(_source_kind),
    btrim(_source_key),
    generation_id,
    generation_app_id,
    _audience,
    frozen_payload,
    logical_key
  )
  on conflict (idempotency_key) do nothing
  returning id into created_id;

  if created_id is not null then
    return created_id;
  end if;

  -- A concurrent caller may have inserted the same key after our initial read.
  -- Re-read the now-immutable row and accept it only when it is exactly the
  -- same logical request; config rotation cannot turn the key into a new send.
  select o.*
    into existing
  from private.onesignal_outbox o
  where o.idempotency_key=logical_key;

  if not found then
    raise exception 'onesignal_outbox_idempotency_conflict'
      using errcode='23505';
  end if;

  frozen_payload:=
    (((_payload-'app_id')-'idempotency_key')-'data')
    || _audience
    || jsonb_build_object(
         'app_id',existing.app_id,
         'idempotency_key',logical_key::text,
         'target_channel','push',
         'data',frozen_data || jsonb_build_object(
           'organization_id',_organization_id::text
         )
       );

  if existing.organization_id is distinct from _organization_id
     or existing.push_type is distinct from btrim(_push_type)
     or existing.source_kind is distinct from btrim(_source_kind)
     or existing.source_key is distinct from btrim(_source_key)
     or existing.audience is distinct from _audience
     or existing.payload is distinct from frozen_payload then
    raise exception 'onesignal_outbox_idempotency_conflict'
      using errcode='23505';
  end if;

  return existing.id;
end
$$;

revoke all on function private.visionfood_onesignal_outbox_enqueue(uuid,text,text,text,jsonb,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function private.visionfood_onesignal_outbox_enqueue(uuid,text,text,text,jsonb,jsonb,uuid)
  to service_role;

-- Internal claim primitive. It is deliberately not granted to service_role on
-- its own: dispatch invokes it inside the same transaction that submits pg_net
-- and persists the immutable attempt/request_id pair.
create or replace function private.visionfood_onesignal_outbox_claim(
  _worker text,
  _batch_limit integer default 10,
  _lease_seconds integer default 30
)
returns table(
  claimed_outbox_id uuid,
  claimed_attempt_no integer,
  claimed_lease_token uuid,
  claimed_app_id text,
  claimed_generation_id uuid,
  claimed_payload jsonb
)
language plpgsql
security definer
set search_path=''
as $$
declare
  worker_name text:=left(btrim(coalesce(_worker,'')),200);
  batch_size integer:=greatest(1,least(coalesce(_batch_limit,10),100));
  lease_seconds integer:=greatest(5,least(coalesce(_lease_seconds,30),300));
begin
  if worker_name='' then
    raise exception 'onesignal_outbox_worker_required'
      using errcode='22023';
  end if;

  return query
  with candidates as (
    select o.id
    from private.onesignal_outbox o
    where o.status in ('pending','retry')
      and o.available_at<=pg_catalog.clock_timestamp()
    order by o.available_at,o.created_at,o.id
    for update skip locked
    limit batch_size
  ), claimed as (
    update private.onesignal_outbox o
       set status='sending',
           attempt_count=o.attempt_count+1,
           lease_token=gen_random_uuid(),
           lease_owner=worker_name,
           lease_expires_at=pg_catalog.clock_timestamp()
             + pg_catalog.make_interval(secs=>lease_seconds),
           last_attempt_at=pg_catalog.clock_timestamp(),
           first_sending_at=coalesce(
             o.first_sending_at,
             pg_catalog.clock_timestamp()
           ),
           last_error=null,
           updated_at=pg_catalog.clock_timestamp()
      from candidates c
     where o.id=c.id
    returning
      o.id,
      o.attempt_count,
      o.lease_token,
      o.app_id,
      o.config_generation_id,
      o.payload
  )
  select
    c.id,
    c.attempt_count,
    c.lease_token,
    c.app_id,
    c.config_generation_id,
    c.payload
  from claimed c;
end
$$;

revoke all on function private.visionfood_onesignal_outbox_claim(text,integer,integer)
  from public,anon,authenticated,service_role;

-- Compare-and-set retry transition for the currently leased attempt only.
-- It never rewrites the frozen logical request.
create or replace function private.visionfood_onesignal_outbox_retry(
  _outbox_id uuid,
  _attempt_no integer,
  _lease_token uuid,
  _reason text,
  _retry_delay_seconds integer default 15,
  _max_attempts integer default 8
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  retry_delay integer:=greatest(1,least(coalesce(_retry_delay_seconds,15),3600));
  max_attempts integer:=greatest(1,least(coalesce(_max_attempts,8),100));
  next_status text;
begin
  update private.onesignal_outbox o
     set status=case
                  when o.attempt_count>=max_attempts then 'failed'
                  else 'retry'
                end,
         available_at=case
                        when o.attempt_count>=max_attempts
                          then o.available_at
                        else pg_catalog.clock_timestamp()
                             + pg_catalog.make_interval(secs=>retry_delay)
                      end,
         lease_token=null,
         lease_owner=null,
         lease_expires_at=null,
         last_error=left(coalesce(_reason,'retry'),2000),
         failed_at=case
                     when o.attempt_count>=max_attempts
                       then pg_catalog.clock_timestamp()
                     else null
                   end,
         updated_at=pg_catalog.clock_timestamp()
   where o.id=_outbox_id
     and o.status='sending'
     and o.attempt_count=_attempt_no
     and o.lease_token=_lease_token
  returning o.status into next_status;

  return next_status;
end
$$;

revoke all on function private.visionfood_onesignal_outbox_retry(uuid,integer,uuid,text,integer,integer)
  from public,anon,authenticated,service_role;

-- Claim and submit in one transaction. pg_net cannot observe/transmit the HTTP
-- row until the same commit also publishes the sending outbox state and the
-- attempt containing its transport request id.
create or replace function private.visionfood_onesignal_outbox_dispatch(
  _worker text,
  _batch_limit integer default 10,
  _lease_seconds integer default 30,
  _retry_delay_seconds integer default 15,
  _max_attempts integer default 8
)
returns table(
  dispatched_outbox_id uuid,
  dispatched_attempt_no integer,
  dispatched_request_id bigint,
  dispatch_state text
)
language plpgsql
security definer
set search_path=''
as $$
declare
  c record;
  api_key text;
  request_id bigint;
  retry_state text;
  failure_text text;
begin
  for c in
    select *
    from private.visionfood_onesignal_outbox_claim(
      _worker,
      _batch_limit,
      _lease_seconds
    )
  loop
    api_key:=null;
    request_id:=null;

    select ds.decrypted_secret
      into api_key
    from private.onesignal_config_generations g
    join vault.decrypted_secrets ds
      on ds.id=g.api_key_secret_id
    where g.id=c.claimed_generation_id
      and g.app_id=c.claimed_app_id
    limit 1;

    if not found
       or nullif(btrim(coalesce(api_key,'')),'') is null then
      insert into private.onesignal_outbox_attempts(
        outbox_id,
        attempt_no,
        lease_token,
        created_at,
        submitted_at,
        result_observed_at,
        error_text,
        semantic_outcome
      )
      values(
        c.claimed_outbox_id,
        c.claimed_attempt_no,
        c.claimed_lease_token,
        pg_catalog.clock_timestamp(),
        null,
        pg_catalog.clock_timestamp(),
        'config_generation_secret_missing',
        'failed'
      );

      update private.onesignal_outbox o
         set status='failed',
             lease_token=null,
             lease_owner=null,
             lease_expires_at=null,
             last_error='config_generation_secret_missing',
             failed_at=pg_catalog.clock_timestamp(),
             updated_at=pg_catalog.clock_timestamp()
       where o.id=c.claimed_outbox_id
         and o.status='sending'
         and o.attempt_count=c.claimed_attempt_no
         and o.lease_token=c.claimed_lease_token;

      return query select
        c.claimed_outbox_id,
        c.claimed_attempt_no,
        null::bigint,
        'failed'::text;
      continue;
    end if;

    begin
      select net.http_post(
        url:='https://api.onesignal.com/notifications',
        body:=c.claimed_payload,
        headers:=jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Key '||api_key
        ),
        timeout_milliseconds:=5000
      )
      into request_id;

      if request_id is null or request_id<=0 then
        raise exception 'pg_net_request_id_missing';
      end if;

      insert into private.onesignal_outbox_attempts(
        outbox_id,
        attempt_no,
        lease_token,
        pg_net_request_id,
        created_at,
        submitted_at
      )
      values(
        c.claimed_outbox_id,
        c.claimed_attempt_no,
        c.claimed_lease_token,
        request_id,
        pg_catalog.clock_timestamp(),
        pg_catalog.clock_timestamp()
      );

      update private.onesignal_outbox o
         set last_request_id=request_id,
             updated_at=pg_catalog.clock_timestamp()
       where o.id=c.claimed_outbox_id
         and o.status='sending'
         and o.attempt_count=c.claimed_attempt_no
         and o.lease_token=c.claimed_lease_token;

      if not found then
        raise exception 'onesignal_outbox_claim_lost_before_dispatch_persist';
      end if;

      return query select
        c.claimed_outbox_id,
        c.claimed_attempt_no,
        request_id,
        'submitted'::text;
    exception
      when others then
        -- The exception block is a subtransaction. If net.http_post inserted a
        -- queue row before a later statement failed, that transport insert is
        -- rolled back before this durable retry outcome is written.
        failure_text:=left(coalesce(sqlerrm,'dispatch_failed'),2000);

        insert into private.onesignal_outbox_attempts(
          outbox_id,
          attempt_no,
          lease_token,
          created_at,
          result_observed_at,
          error_text,
          semantic_outcome
        )
        values(
          c.claimed_outbox_id,
          c.claimed_attempt_no,
          c.claimed_lease_token,
          pg_catalog.clock_timestamp(),
          pg_catalog.clock_timestamp(),
          failure_text,
          'retry'
        );

        retry_state:=private.visionfood_onesignal_outbox_retry(
          c.claimed_outbox_id,
          c.claimed_attempt_no,
          c.claimed_lease_token,
          failure_text,
          _retry_delay_seconds,
          _max_attempts
        );

        return query select
          c.claimed_outbox_id,
          c.claimed_attempt_no,
          null::bigint,
          coalesce(retry_state,'stale')::text;
    end;
  end loop;
end
$$;

revoke all on function private.visionfood_onesignal_outbox_dispatch(text,integer,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function private.visionfood_onesignal_outbox_dispatch(text,integer,integer,integer,integer)
  to service_role;

-- Observe pg_net responses without using its request queue as durable state.
-- Correlation is fail-closed: a reused request id or multiple response rows in
-- the attempt's time window is ambiguous and can only cause an idempotent retry.
-- A missing response never finalizes the attempt; after lease expiry it merely
-- releases the logical outbox row for retry so a late success can still win.
create or replace function private.visionfood_onesignal_outbox_reconcile(
  _batch_limit integer default 100,
  _retry_delay_seconds integer default 15,
  _max_attempts integer default 8
)
returns table(
  reconciled_outbox_id uuid,
  reconciled_attempt_no integer,
  reconcile_state text
)
language plpgsql
security definer
set search_path=''
as $$
declare
  a record;
  o record;
  request_matches bigint;
  response_matches bigint;
  response_status integer;
  response_timed_out boolean;
  response_error text;
  response_body text;
  response_payload jsonb;
  notification_id text;
  retryable boolean;
  failure_reason text;
  retry_state text;
  batch_size integer:=greatest(1,least(coalesce(_batch_limit,100),500));
begin
  for a in
    select x.*
    from private.onesignal_outbox_attempts x
    where x.result_observed_at is null
      and x.pg_net_request_id is not null
    order by x.submitted_at,x.id
    for update skip locked
    limit batch_size
  loop
    select count(*)
      into request_matches
    from private.onesignal_outbox_attempts x
    where x.pg_net_request_id=a.pg_net_request_id;

    if request_matches<>1 then
      update private.onesignal_outbox_attempts x
         set result_observed_at=pg_catalog.clock_timestamp(),
             error_text='transport_request_id_ambiguous',
             semantic_outcome='retry'
       where x.id=a.id;

      select o2.status,o2.attempt_count,o2.lease_token,o2.lease_expires_at
        into o
      from private.onesignal_outbox o2
      where o2.id=a.outbox_id;

      if found
         and o.status='sending'
         and o.attempt_count=a.attempt_no
         and o.lease_token=a.lease_token then
        retry_state:=private.visionfood_onesignal_outbox_retry(
          a.outbox_id,
          a.attempt_no,
          a.lease_token,
          'transport_request_id_ambiguous',
          _retry_delay_seconds,
          _max_attempts
        );
      else
        retry_state:='stale';
      end if;

      return query select a.outbox_id,a.attempt_no,coalesce(retry_state,'stale');
      continue;
    end if;

    select count(*)
      into response_matches
    from net._http_response r
    where r.id=a.pg_net_request_id
      and r.created>=coalesce(a.submitted_at,a.created_at);

    if response_matches=0 then
      select o2.status,o2.attempt_count,o2.lease_token,o2.lease_expires_at
        into o
      from private.onesignal_outbox o2
      where o2.id=a.outbox_id;

      if found
         and o.status='sending'
         and o.attempt_count=a.attempt_no
         and o.lease_token=a.lease_token
         and o.lease_expires_at<=pg_catalog.clock_timestamp() then
        retry_state:=private.visionfood_onesignal_outbox_retry(
          a.outbox_id,
          a.attempt_no,
          a.lease_token,
          'response_missing',
          _retry_delay_seconds,
          _max_attempts
        );

        return query select
          a.outbox_id,
          a.attempt_no,
          coalesce(retry_state,'stale');
      else
        return query select a.outbox_id,a.attempt_no,'waiting'::text;
      end if;

      -- Keep attempt.result_observed_at NULL. A late OneSignal success from this
      -- exact transport attempt may still appear and must be able to promote the
      -- logical outbox to delivered after a retry has already started.
      continue;
    end if;

    if response_matches<>1 then
      update private.onesignal_outbox_attempts x
         set result_observed_at=pg_catalog.clock_timestamp(),
             error_text='transport_response_ambiguous',
             semantic_outcome='retry'
       where x.id=a.id;

      select o2.status,o2.attempt_count,o2.lease_token,o2.lease_expires_at
        into o
      from private.onesignal_outbox o2
      where o2.id=a.outbox_id;

      if found
         and o.status='sending'
         and o.attempt_count=a.attempt_no
         and o.lease_token=a.lease_token then
        retry_state:=private.visionfood_onesignal_outbox_retry(
          a.outbox_id,
          a.attempt_no,
          a.lease_token,
          'transport_response_ambiguous',
          _retry_delay_seconds,
          _max_attempts
        );
      else
        retry_state:='stale';
      end if;

      return query select a.outbox_id,a.attempt_no,coalesce(retry_state,'stale');
      continue;
    end if;

    select r.status_code,r.timed_out,r.error_msg,r.content
      into response_status,response_timed_out,response_error,response_body
    from net._http_response r
    where r.id=a.pg_net_request_id
      and r.created>=coalesce(a.submitted_at,a.created_at)
    order by r.created desc
    limit 1;

    response_payload:=null;
    notification_id:=null;

    if response_status>=200
       and response_status<300
       and not coalesce(response_timed_out,false)
       and nullif(btrim(coalesce(response_error,'')),'') is null then
      begin
        response_payload:=response_body::jsonb;
      exception
        when others then
          response_payload:=null;
      end;

      notification_id:=nullif(
        btrim(coalesce(response_payload->>'id','')),
        ''
      );
    end if;

    if notification_id is not null then
      update private.onesignal_outbox_attempts x
         set result_observed_at=pg_catalog.clock_timestamp(),
             http_status=response_status,
             timed_out=coalesce(response_timed_out,false),
             error_text=response_error,
             response_body=response_body,
             semantic_outcome='delivered',
             onesignal_notification_id=notification_id
       where x.id=a.id;

      -- Semantic success is monotonic and wins even when it arrives from an old
      -- attempt after a newer retry or after a terminal failure decision.
      update private.onesignal_outbox outbox
         set status='delivered',
             lease_token=null,
             lease_owner=null,
             lease_expires_at=null,
             last_request_id=a.pg_net_request_id,
             last_http_status=response_status,
             last_error=null,
             last_response_body=response_body,
             onesignal_notification_id=notification_id,
             delivered_at=coalesce(
               outbox.delivered_at,
               pg_catalog.clock_timestamp()
             ),
             failed_at=null,
             updated_at=pg_catalog.clock_timestamp()
       where outbox.id=a.outbox_id
         and outbox.status<>'delivered';

      return query select a.outbox_id,a.attempt_no,'delivered'::text;
      continue;
    end if;

    retryable:=
      response_status is null
      or coalesce(response_timed_out,false)
      or nullif(btrim(coalesce(response_error,'')),'') is not null
      or response_status=408
      or response_status=429
      or response_status>=500;

    failure_reason:=case
      when retryable then 'retryable_transport_failure'
      when response_status>=200 and response_status<300
        then 'onesignal_not_created'
      else 'onesignal_rejected'
    end;

    update private.onesignal_outbox_attempts x
       set result_observed_at=pg_catalog.clock_timestamp(),
           http_status=response_status,
           timed_out=coalesce(response_timed_out,false),
           error_text=coalesce(response_error,failure_reason),
           response_body=response_body,
           semantic_outcome=case when retryable then 'retry' else 'failed' end
     where x.id=a.id;

    select o2.status,o2.attempt_count,o2.lease_token,o2.lease_expires_at
      into o
    from private.onesignal_outbox o2
    where o2.id=a.outbox_id;

    if not found or o.attempt_count<>a.attempt_no then
      -- A failure from an older attempt must never regress a newer state.
      return query select a.outbox_id,a.attempt_no,'stale_failure'::text;
      continue;
    end if;

    if retryable then
      update private.onesignal_outbox outbox
         set last_request_id=a.pg_net_request_id,
             last_http_status=response_status,
             last_error=coalesce(response_error,failure_reason),
             last_response_body=response_body,
             updated_at=pg_catalog.clock_timestamp()
       where outbox.id=a.outbox_id
         and outbox.attempt_count=a.attempt_no
         and outbox.status in ('sending','retry');

      if o.status='sending' and o.lease_token=a.lease_token then
        retry_state:=private.visionfood_onesignal_outbox_retry(
          a.outbox_id,
          a.attempt_no,
          a.lease_token,
          failure_reason,
          _retry_delay_seconds,
          _max_attempts
        );
      elsif o.status='retry' then
        retry_state:='retry';
      else
        retry_state:='stale';
      end if;

      return query select a.outbox_id,a.attempt_no,coalesce(retry_state,'stale');
      continue;
    end if;

    -- Definitive rejection applies only while this is still the newest attempt.
    update private.onesignal_outbox outbox
       set status='failed',
           lease_token=null,
           lease_owner=null,
           lease_expires_at=null,
           last_request_id=a.pg_net_request_id,
           last_http_status=response_status,
           last_error=failure_reason,
           last_response_body=response_body,
           failed_at=coalesce(
             outbox.failed_at,
             pg_catalog.clock_timestamp()
           ),
           updated_at=pg_catalog.clock_timestamp()
     where outbox.id=a.outbox_id
       and outbox.attempt_count=a.attempt_no
       and outbox.status in ('sending','retry')
       and (
         outbox.status='retry'
         or outbox.lease_token=a.lease_token
       );

    return query select a.outbox_id,a.attempt_no,'failed'::text;
  end loop;
end
$$;

revoke all on function private.visionfood_onesignal_outbox_reconcile(integer,integer,integer)
  from public,anon,authenticated;
grant execute on function private.visionfood_onesignal_outbox_reconcile(integer,integer,integer)
  to service_role;

-- Phase 3 intentionally leaves all current producers and legacy rotation guards
-- untouched. Cutover happens only in later phases after each producer is proven
-- on the durable path.
