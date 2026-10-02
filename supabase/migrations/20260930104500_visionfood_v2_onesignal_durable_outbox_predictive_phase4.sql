-- OneSignal Durable Outbox V2 - phase 4.
--
-- Cut over only predictive stock pushes to the durable outbox. Delivery and
-- rupture remain on the legacy queue in this phase.
--
-- The predictive public request_id remains bigint for API compatibility, but
-- it is now an opaque durable token mapped to an outbox UUID. pg_net request
-- ids remain attempt metadata only.

alter table private.onesignal_predictive_push_dedupe
  add column if not exists outbox_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conname='onesignal_predictive_push_dedupe_outbox_fk'
      and c.conrelid='private.onesignal_predictive_push_dedupe'::regclass
  ) then
    alter table private.onesignal_predictive_push_dedupe
      add constraint onesignal_predictive_push_dedupe_outbox_fk
      foreign key (outbox_id)
      references private.onesignal_outbox(id)
      on delete set null;
  end if;
end
$$;

create index if not exists onesignal_predictive_push_dedupe_outbox_idx
  on private.onesignal_predictive_push_dedupe(outbox_id)
  where outbox_id is not null;

create sequence if not exists private.onesignal_predictive_request_id_seq
  as bigint
  minvalue 1
  maxvalue 9007199254740991
  no cycle;

select pg_catalog.setval(
  'private.onesignal_predictive_request_id_seq',
  greatest(
    1::bigint,
    coalesce(
      (
        select max(d.request_id)+1
        from private.onesignal_predictive_push_dedupe d
      ),
      1::bigint
    )
  ),
  false
);

revoke all on sequence private.onesignal_predictive_request_id_seq
  from public,anon,authenticated,service_role;

-- Targeted dispatcher used by the predictive RPC. It is the same durable
-- state machine as phase 3, but claims only the requested outbox row so a
-- predictive request never depends on unrelated backlog ordering.
create or replace function private.visionfood_onesignal_outbox_dispatch_one(
  _outbox_id uuid,
  _worker text default 'predictive-rpc',
  _lease_seconds integer default 30,
  _retry_delay_seconds integer default 15,
  _max_attempts integer default 8
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  worker_name text:=left(btrim(coalesce(_worker,'')),200);
  lease_seconds integer:=greatest(5,least(coalesce(_lease_seconds,30),300));
  claimed_attempt_no integer;
  claimed_lease_token uuid;
  claimed_app_id text;
  claimed_generation_id uuid;
  claimed_payload jsonb;
  api_key text;
  request_id bigint;
  retry_state text;
  failure_text text;
begin
  if _outbox_id is null then
    return null;
  end if;

  if worker_name='' then
    raise exception 'onesignal_outbox_worker_required'
      using errcode='22023';
  end if;

  with candidate as (
    select o.id
    from private.onesignal_outbox o
    where o.id=_outbox_id
      and o.status in ('pending','retry')
      and o.available_at<=pg_catalog.clock_timestamp()
    for update skip locked
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
      from candidate c
     where o.id=c.id
    returning
      o.attempt_count,
      o.lease_token,
      o.app_id,
      o.config_generation_id,
      o.payload
  )
  select
    c.attempt_count,
    c.lease_token,
    c.app_id,
    c.config_generation_id,
    c.payload
  into
    claimed_attempt_no,
    claimed_lease_token,
    claimed_app_id,
    claimed_generation_id,
    claimed_payload
  from claimed c;

  if not found then
    return null;
  end if;

  select ds.decrypted_secret
    into api_key
  from private.onesignal_config_generations g
  join vault.decrypted_secrets ds
    on ds.id=g.api_key_secret_id
  where g.id=claimed_generation_id
    and g.app_id=claimed_app_id
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
      _outbox_id,
      claimed_attempt_no,
      claimed_lease_token,
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
     where o.id=_outbox_id
       and o.status='sending'
       and o.attempt_count=claimed_attempt_no
       and o.lease_token=claimed_lease_token;

    return null;
  end if;

  begin
    select net.http_post(
      url:='https://api.onesignal.com/notifications',
      body:=claimed_payload,
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
      _outbox_id,
      claimed_attempt_no,
      claimed_lease_token,
      request_id,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    );

    update private.onesignal_outbox o
       set last_request_id=request_id,
           updated_at=pg_catalog.clock_timestamp()
     where o.id=_outbox_id
       and o.status='sending'
       and o.attempt_count=claimed_attempt_no
       and o.lease_token=claimed_lease_token;

    if not found then
      raise exception 'onesignal_outbox_claim_lost_before_dispatch_persist';
    end if;

    return request_id;
  exception
    when others then
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
        _outbox_id,
        claimed_attempt_no,
        claimed_lease_token,
        pg_catalog.clock_timestamp(),
        pg_catalog.clock_timestamp(),
        failure_text,
        'retry'
      );

      retry_state:=private.visionfood_onesignal_outbox_retry(
        _outbox_id,
        claimed_attempt_no,
        claimed_lease_token,
        failure_text,
        _retry_delay_seconds,
        _max_attempts
      );

      return null;
  end;
end
$$;

revoke all on function private.visionfood_onesignal_outbox_dispatch_one(uuid,text,integer,integer,integer)
  from public,anon,authenticated,service_role;

create or replace function public.visionfood_push_predictive_stock(
  _org uuid,
  _ingredient_name text,
  _days_remaining integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  ing text:=left(btrim(coalesce(_ingredient_name,'')),120);
  ingredient_key text;
  days int:=greatest(1,least(coalesce(_days_remaining,1),365));
  advisory_key bigint;

  previous_request_id bigint;
  previous_queued_at timestamptz;
  previous_confirmed_at timestamptz;
  previous_outbox_id uuid;

  outbox_status text;
  outbox_delivered_at timestamptz;
  outbox_last_error text;
  outbox_app_id text;
  unresolved_attempt boolean:=false;

  subscription_ids jsonb;
  predictive_idempotency_key uuid;
  predictive_outbox_id uuid;
  public_request_id bigint;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  if not public.usuario_dono_org(_org,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if ing='' then
    return jsonb_build_object('ok',false,'reason','invalid_ingredient');
  end if;

  ingredient_key:=lower(regexp_replace(ing,'[[:space:]]+',' ','g'));
  advisory_key:=pg_catalog.hashtextextended(
    'visionfood_predictive_push:'||_org::text||':'||ingredient_key||':'||days::text,
    0
  );

  perform pg_catalog.pg_advisory_xact_lock(advisory_key);

  select
    d.request_id,
    d.last_queued_at,
    d.last_confirmed_at,
    d.outbox_id
  into
    previous_request_id,
    previous_queued_at,
    previous_confirmed_at,
    previous_outbox_id
  from private.onesignal_predictive_push_dedupe d
  where d.organization_id=_org
    and d.ingredient_key=ingredient_key
    and d.days_remaining=days;

  if found then
    if previous_outbox_id is null then
      -- Rows created before phase 4 are intentionally not reverse-engineered
      -- from pg_net. Preserve their logical cooldown fail-closed, then allow a
      -- fresh outbox request after the horizon expires.
      if previous_confirmed_at is not null
         and previous_confirmed_at >
             pg_catalog.clock_timestamp() - interval '24 hours' then
        return jsonb_build_object(
          'ok',true,
          'queued',true,
          'delivered',true,
          'pending',false,
          'deduplicated',true,
          'request_id',previous_request_id
        );
      end if;

      if previous_queued_at >
         pg_catalog.clock_timestamp() - interval '24 hours' then
        return jsonb_build_object(
          'ok',true,
          'queued',true,
          'delivered',false,
          'pending',true,
          'deduplicated',true,
          'reason','legacy_request_cooldown',
          'request_id',previous_request_id
        );
      end if;

      delete from private.onesignal_predictive_push_dedupe d
      where d.organization_id=_org
        and d.ingredient_key=ingredient_key
        and d.days_remaining=days
        and d.request_id=previous_request_id;
    else
      -- Reconcile transport observations into durable outbox state. The
      -- predictive domain reads only that durable state afterwards.
      perform private.visionfood_onesignal_outbox_reconcile(500,15,8);

      select o.status,o.delivered_at,o.last_error,o.app_id
        into outbox_status,outbox_delivered_at,outbox_last_error,outbox_app_id
      from private.onesignal_outbox o
      where o.id=previous_outbox_id
        and o.organization_id=_org
        and o.push_type='predictive_stock';

      if not found then
        if previous_queued_at >
           pg_catalog.clock_timestamp() - interval '24 hours' then
          return jsonb_build_object(
            'ok',true,
            'queued',true,
            'delivered',false,
            'pending',true,
            'deduplicated',true,
            'reason','durable_request_missing',
            'request_id',previous_request_id
          );
        end if;

        delete from private.onesignal_predictive_push_dedupe d
        where d.organization_id=_org
          and d.ingredient_key=ingredient_key
          and d.days_remaining=days
          and d.request_id=previous_request_id;
      else
        if outbox_status in ('pending','retry') then
          perform private.visionfood_onesignal_outbox_dispatch_one(
            previous_outbox_id,
            'predictive-rpc',
            30,
            15,
            8
          );

          select o.status,o.delivered_at,o.last_error,o.app_id
            into outbox_status,outbox_delivered_at,outbox_last_error,outbox_app_id
          from private.onesignal_outbox o
          where o.id=previous_outbox_id;
        end if;

        if outbox_status='delivered' then
          update private.onesignal_predictive_push_dedupe d
             set last_confirmed_at=coalesce(
               d.last_confirmed_at,
               outbox_delivered_at,
               pg_catalog.clock_timestamp()
             )
           where d.organization_id=_org
             and d.ingredient_key=ingredient_key
             and d.days_remaining=days
             and d.request_id=previous_request_id;

          if coalesce(
               previous_confirmed_at,
               outbox_delivered_at,
               pg_catalog.clock_timestamp()
             ) > pg_catalog.clock_timestamp() - interval '24 hours' then
            return jsonb_build_object(
              'ok',true,
              'queued',true,
              'delivered',true,
              'pending',false,
              'deduplicated',true,
              'request_id',previous_request_id
            );
          end if;

          delete from private.onesignal_predictive_push_dedupe d
          where d.organization_id=_org
            and d.ingredient_key=ingredient_key
            and d.days_remaining=days
            and d.request_id=previous_request_id;

        elsif outbox_status in ('pending','sending','retry') then
          return jsonb_build_object(
            'ok',true,
            'queued',true,
            'delivered',false,
            'pending',true,
            'deduplicated',true,
            'request_id',previous_request_id
          );

        elsif outbox_status='failed' then
          select exists(
            select 1
            from private.onesignal_outbox_attempts a
            where a.outbox_id=previous_outbox_id
              and a.result_observed_at is null
          )
          into unresolved_attempt;

          if outbox_last_error in ('onesignal_not_created','onesignal_rejected')
             and not unresolved_attempt then
            delete from private.onesignal_predictive_push_dedupe d
            where d.organization_id=_org
              and d.ingredient_key=ingredient_key
              and d.days_remaining=days
              and d.request_id=previous_request_id;
          else
            return jsonb_build_object(
              'ok',true,
              'queued',true,
              'delivered',false,
              'pending',false,
              'failed',true,
              'deduplicated',true,
              'reason',coalesce(outbox_last_error,'delivery_failed'),
              'request_id',previous_request_id
            );
          end if;
        end if;
      end if;
    end if;
  end if;

  subscription_ids:=private.visionfood_admin_push_subscription_ids(_org);

  if pg_catalog.jsonb_typeof(subscription_ids)<>'array'
     or pg_catalog.jsonb_array_length(subscription_ids)=0 then
    return jsonb_build_object(
      'ok',true,
      'queued',false,
      'reason','no_admin_subscriptions'
    );
  end if;

  predictive_idempotency_key:=gen_random_uuid();

  begin
    predictive_outbox_id:=private.visionfood_onesignal_outbox_enqueue(
      _org,
      'predictive_stock',
      'predictive_stock',
      ingredient_key||':'||days::text,
      jsonb_build_object(
        'include_subscription_ids',
        subscription_ids
      ),
      jsonb_build_object(
        'headings',
        jsonb_build_object('pt','🚨 Alerta de Estoque'),
        'contents',
        jsonb_build_object(
          'pt',
          'O item '||ing||' pode acabar em '||days||
          ' dia(s). Veja a sugestão no painel.'
        ),
        'data',
        jsonb_build_object(
          'event','predictive_stock',
          'days_remaining',days
        )
      ),
      predictive_idempotency_key
    );
  exception
    when others then
      if sqlstate='55000'
         and sqlerrm='onesignal_outbox_not_configured' then
        return jsonb_build_object(
          'ok',true,
          'queued',false,
          'reason','not_configured'
        );
      end if;
      raise;
  end;

  select o.app_id
    into outbox_app_id
  from private.onesignal_outbox o
  where o.id=predictive_outbox_id
    and o.organization_id=_org
    and o.push_type='predictive_stock';

  if not found then
    raise exception 'predictive_outbox_enqueue_missing'
      using errcode='55000';
  end if;

  public_request_id:=nextval(
    'private.onesignal_predictive_request_id_seq'::regclass
  );

  insert into private.onesignal_predictive_push_dedupe(
    organization_id,
    ingredient_key,
    days_remaining,
    last_queued_at,
    request_id,
    last_confirmed_at,
    app_id,
    subscription_ids,
    idempotency_key,
    outbox_id
  )
  values(
    _org,
    ingredient_key,
    days,
    pg_catalog.clock_timestamp(),
    public_request_id,
    null,
    outbox_app_id,
    subscription_ids,
    predictive_idempotency_key,
    predictive_outbox_id
  )
  on conflict (organization_id,ingredient_key,days_remaining)
  do update
    set last_queued_at=excluded.last_queued_at,
        request_id=excluded.request_id,
        last_confirmed_at=null,
        app_id=excluded.app_id,
        subscription_ids=excluded.subscription_ids,
        idempotency_key=excluded.idempotency_key,
        outbox_id=excluded.outbox_id;

  perform private.visionfood_onesignal_outbox_dispatch_one(
    predictive_outbox_id,
    'predictive-rpc',
    30,
    15,
    8
  );

  select o.status,o.delivered_at,o.last_error
    into outbox_status,outbox_delivered_at,outbox_last_error
  from private.onesignal_outbox o
  where o.id=predictive_outbox_id;

  if outbox_status='delivered' then
    update private.onesignal_predictive_push_dedupe d
       set last_confirmed_at=coalesce(
         outbox_delivered_at,
         pg_catalog.clock_timestamp()
       )
     where d.organization_id=_org
       and d.ingredient_key=ingredient_key
       and d.days_remaining=days
       and d.request_id=public_request_id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'queued',true,
    'delivered',outbox_status='delivered',
    'pending',outbox_status in ('pending','sending','retry'),
    'failed',outbox_status='failed',
    'deduplicated',false,
    'request_id',public_request_id,
    'reason',
      case
        when outbox_status='failed'
          then coalesce(outbox_last_error,'delivery_failed')
        else null
      end
  );
end
$$;

revoke all on function public.visionfood_push_predictive_stock(uuid,text,integer)
  from public,anon;

grant execute on function public.visionfood_push_predictive_stock(uuid,text,integer)
  to authenticated,service_role;

create or replace function public.visionfood_predictive_push_result(
  _org uuid,
  _request_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  queued_at timestamptz;
  confirmed_at timestamptz;
  predictive_outbox_id uuid;
  outbox_status text;
  outbox_delivered_at timestamptz;
  outbox_last_error text;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  if not public.usuario_dono_org(_org,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if _request_id is null or _request_id<=0 then
    return jsonb_build_object('ok',false,'reason','invalid_request_id');
  end if;

  select d.last_queued_at,d.last_confirmed_at,d.outbox_id
    into queued_at,confirmed_at,predictive_outbox_id
  from private.onesignal_predictive_push_dedupe d
  where d.organization_id=_org
    and d.request_id=_request_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','unknown_request');
  end if;

  if predictive_outbox_id is null then
    if confirmed_at is not null then
      return jsonb_build_object(
        'ok',true,
        'delivered',true,
        'pending',false,
        'request_id',_request_id
      );
    end if;

    if queued_at > pg_catalog.clock_timestamp() - interval '24 hours' then
      return jsonb_build_object(
        'ok',true,
        'delivered',false,
        'pending',true,
        'request_id',_request_id
      );
    end if;

    return jsonb_build_object(
      'ok',true,
      'delivered',false,
      'pending',false,
      'failed',true,
      'reason','legacy_request_expired',
      'request_id',_request_id
    );
  end if;

  perform private.visionfood_onesignal_outbox_reconcile(500,15,8);

  select o.status,o.delivered_at,o.last_error
    into outbox_status,outbox_delivered_at,outbox_last_error
  from private.onesignal_outbox o
  where o.id=predictive_outbox_id
    and o.organization_id=_org
    and o.push_type='predictive_stock';

  if not found then
    return jsonb_build_object(
      'ok',true,
      'delivered',false,
      'pending',false,
      'failed',true,
      'reason','durable_request_missing',
      'request_id',_request_id
    );
  end if;

  if outbox_status in ('pending','retry') then
    perform private.visionfood_onesignal_outbox_dispatch_one(
      predictive_outbox_id,
      'predictive-result-rpc',
      30,
      15,
      8
    );

    select o.status,o.delivered_at,o.last_error
      into outbox_status,outbox_delivered_at,outbox_last_error
    from private.onesignal_outbox o
    where o.id=predictive_outbox_id;
  end if;

  if outbox_status='delivered' then
    update private.onesignal_predictive_push_dedupe d
       set last_confirmed_at=coalesce(
         d.last_confirmed_at,
         outbox_delivered_at,
         pg_catalog.clock_timestamp()
       )
     where d.organization_id=_org
       and d.request_id=_request_id;

    return jsonb_build_object(
      'ok',true,
      'delivered',true,
      'pending',false,
      'request_id',_request_id
    );
  end if;

  if outbox_status='failed' then
    return jsonb_build_object(
      'ok',true,
      'delivered',false,
      'pending',false,
      'failed',true,
      'reason',coalesce(outbox_last_error,'delivery_failed'),
      'request_id',_request_id
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'delivered',false,
    'pending',true,
    'request_id',_request_id
  );
end
$$;

revoke all on function public.visionfood_predictive_push_result(uuid,bigint)
  from public,anon;

grant execute on function public.visionfood_predictive_push_result(uuid,bigint)
  to authenticated,service_role;
