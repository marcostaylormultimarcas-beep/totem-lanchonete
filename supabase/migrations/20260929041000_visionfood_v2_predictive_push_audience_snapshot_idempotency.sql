-- Keep an ambiguous predictive push retry byte-for-byte aligned on its
-- organization-scoped OneSignal audience. The idempotency key represents one
-- logical request, so include_subscription_ids must not drift while that key is
-- reused after an uncertain pg_net result.

alter table private.onesignal_predictive_push_dedupe
  add column if not exists subscription_ids jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conname='onesignal_predictive_push_dedupe_subscription_ids_chk'
      and c.conrelid='private.onesignal_predictive_push_dedupe'::regclass
  ) then
    alter table private.onesignal_predictive_push_dedupe
      add constraint onesignal_predictive_push_dedupe_subscription_ids_chk
      check (
        subscription_ids is null
        or (
          pg_catalog.jsonb_typeof(subscription_ids)='array'
          and pg_catalog.jsonb_array_length(subscription_ids)>0
        )
      );
  end if;
end
$$;

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
  request_id bigint;
  ing text:=left(btrim(coalesce(_ingredient_name,'')),120);
  ingredient_key text;
  days int:=greatest(1,least(coalesce(_days_remaining,1),365));
  previous_request_id bigint;
  previous_queued_at timestamptz;
  previous_confirmed_at timestamptz;
  previous_idempotency_key uuid;
  previous_app_id text;
  previous_subscription_ids jsonb;
  previous_audience_valid boolean:=false;
  current_subscription_ids jsonb;
  current_app_id text;
  predictive_idempotency_key uuid;
  response_status integer;
  response_timed_out boolean;
  response_error text;
  response_body text;
  response_payload jsonb;
  onesignal_notification_id text;
  retryable_response boolean:=false;
  still_queued boolean:=false;
  advisory_key bigint;
  subscription_ids jsonb;
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

  -- Keep configuration stable for the retry decision, audience selection and
  -- queue call. set_onesignal_config uses FOR UPDATE on the same row.
  select btrim(coalesce(c.app_id,''))
    into current_app_id
  from private.onesignal_settings c
  where c.id='global'
  for share;

  if not found or coalesce(current_app_id,'')='' then
    return jsonb_build_object('ok',true,'queued',false,'reason','not_configured');
  end if;

  select
    d.request_id,
    d.last_queued_at,
    d.last_confirmed_at,
    d.idempotency_key,
    d.app_id,
    d.subscription_ids
  into
    previous_request_id,
    previous_queued_at,
    previous_confirmed_at,
    previous_idempotency_key,
    previous_app_id,
    previous_subscription_ids
  from private.onesignal_predictive_push_dedupe d
  where d.organization_id=_org
    and d.ingredient_key=ingredient_key
    and d.days_remaining=days;

  if found then
    previous_audience_valid:=
      case
        when pg_catalog.jsonb_typeof(previous_subscription_ids)='array'
          then pg_catalog.jsonb_array_length(previous_subscription_ids)>0
        else false
      end;

    if previous_confirmed_at is not null
       and previous_confirmed_at > pg_catalog.clock_timestamp() - interval '24 hours' then
      return jsonb_build_object(
        'ok',true,
        'queued',true,
        'delivered',true,
        'deduplicated',true,
        'request_id',previous_request_id
      );
    end if;

    -- A confirmed notification whose cooldown already elapsed is a new logical
    -- alert. It gets the currently configured App ID and a fresh key.
    if previous_confirmed_at is not null then
      delete from private.onesignal_predictive_push_dedupe d
      where d.organization_id=_org
        and d.ingredient_key=ingredient_key
        and d.days_remaining=days
        and d.request_id=previous_request_id;

      previous_request_id:=null;
      previous_queued_at:=null;
      previous_confirmed_at:=null;
      previous_idempotency_key:=null;
      previous_app_id:=null;
      previous_subscription_ids:=null;
      previous_audience_valid:=false;
    else
      select r.status_code,r.timed_out,r.error_msg,r.content
        into response_status,response_timed_out,response_error,response_body
      from net._http_response r
      where r.id=previous_request_id
      order by r.created desc
      limit 1;

      if found then
        response_payload:=null;
        onesignal_notification_id:=null;
        retryable_response:=false;

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

          onesignal_notification_id:=
            nullif(btrim(coalesce(response_payload->>'id','')),'');
        end if;

        if onesignal_notification_id is not null then
          update private.onesignal_predictive_push_dedupe d
             set last_confirmed_at=pg_catalog.clock_timestamp()
           where d.organization_id=_org
             and d.ingredient_key=ingredient_key
             and d.days_remaining=days
             and d.request_id=previous_request_id;

          return jsonb_build_object(
            'ok',true,
            'queued',true,
            'delivered',true,
            'deduplicated',true,
            'request_id',previous_request_id
          );
        end if;

        retryable_response:=
          coalesce(response_timed_out,false)
          or nullif(btrim(coalesce(response_error,'')),'') is not null
          or response_status=408
          or response_status=429
          or response_status>=500;

        if retryable_response
           and previous_idempotency_key is not null
           and previous_app_id=current_app_id
           and previous_audience_valid then
          current_subscription_ids:=
            private.visionfood_admin_push_subscription_ids(_org);

          if previous_subscription_ids is distinct from current_subscription_ids then
            if previous_queued_at > pg_catalog.clock_timestamp() - interval '24 hours' then
              return jsonb_build_object(
                'ok',true,
                'queued',true,
                'delivered',false,
                'pending',true,
                'deduplicated',true,
                'reason','audience_changed_ambiguous_request',
                'request_id',previous_request_id
              );
            end if;

            delete from private.onesignal_predictive_push_dedupe d
            where d.organization_id=_org
              and d.ingredient_key=ingredient_key
              and d.days_remaining=days
              and d.request_id=previous_request_id;
          else
            predictive_idempotency_key:=previous_idempotency_key;
            subscription_ids:=previous_subscription_ids;
          end if;
        elsif retryable_response
           and previous_idempotency_key is not null
           and previous_app_id=current_app_id then
          -- Requests created before the audience snapshot existed cannot be
          -- retried safely: rebuilding include_subscription_ids could change
          -- the request body while reusing the same OneSignal key.
          if previous_queued_at > pg_catalog.clock_timestamp() - interval '24 hours' then
            return jsonb_build_object(
              'ok',true,
              'queued',true,
              'delivered',false,
              'pending',true,
              'deduplicated',true,
              'reason','legacy_audience_ambiguous_request',
              'request_id',previous_request_id
            );
          end if;

          delete from private.onesignal_predictive_push_dedupe d
          where d.organization_id=_org
            and d.ingredient_key=ingredient_key
            and d.days_remaining=days
            and d.request_id=previous_request_id;
        elsif retryable_response then
          -- The old result is ambiguous, but its App ID is either unknown or
          -- no longer current. Never carry its key into another OneSignal app.
          if previous_queued_at > pg_catalog.clock_timestamp() - interval '24 hours' then
            return jsonb_build_object(
              'ok',true,
              'queued',true,
              'delivered',false,
              'pending',true,
              'deduplicated',true,
              'reason',
                case
                  when previous_app_id is not null
                   and previous_app_id is distinct from current_app_id
                    then 'app_rotated_ambiguous_request'
                  when previous_app_id is null
                    then 'legacy_app_ambiguous_request'
                  else 'legacy_ambiguous_request'
                end,
              'request_id',previous_request_id
            );
          end if;

          delete from private.onesignal_predictive_push_dedupe d
          where d.organization_id=_org
            and d.ingredient_key=ingredient_key
            and d.days_remaining=days
            and d.request_id=previous_request_id;
        else
          -- A definitive OneSignal rejection (including a semantic 2xx without
          -- an id) did not create a notification, so App B may start a new
          -- logical send with its own key.
          delete from private.onesignal_predictive_push_dedupe d
          where d.organization_id=_org
            and d.ingredient_key=ingredient_key
            and d.days_remaining=days
            and d.request_id=previous_request_id;
        end if;
      else
        select exists(
          select 1
          from net.http_request_queue q
          where q.id=previous_request_id
        )
        into still_queued;

        if still_queued
           or previous_queued_at > pg_catalog.clock_timestamp() - interval '15 seconds' then
          return jsonb_build_object(
            'ok',true,
            'queued',true,
            'delivered',false,
            'pending',true,
            'deduplicated',true,
            'request_id',previous_request_id
          );
        end if;

        if previous_idempotency_key is not null
           and previous_app_id=current_app_id
           and previous_audience_valid then
          current_subscription_ids:=
            private.visionfood_admin_push_subscription_ids(_org);

          if previous_subscription_ids is distinct from current_subscription_ids then
            if previous_queued_at > pg_catalog.clock_timestamp() - interval '24 hours' then
              return jsonb_build_object(
                'ok',true,
                'queued',true,
                'delivered',false,
                'pending',true,
                'deduplicated',true,
                'reason','audience_changed_ambiguous_request',
                'request_id',previous_request_id
              );
            end if;

            delete from private.onesignal_predictive_push_dedupe d
            where d.organization_id=_org
              and d.ingredient_key=ingredient_key
              and d.days_remaining=days
              and d.request_id=previous_request_id;
          else
            -- Same App ID and unchanged organization-scoped audience: replay
            -- exactly the original OneSignal request.
            predictive_idempotency_key:=previous_idempotency_key;
            subscription_ids:=previous_subscription_ids;
          end if;
        elsif previous_idempotency_key is not null
           and previous_app_id=current_app_id
           and previous_queued_at > pg_catalog.clock_timestamp() - interval '24 hours' then
          return jsonb_build_object(
            'ok',true,
            'queued',true,
            'delivered',false,
            'pending',true,
            'deduplicated',true,
            'reason','legacy_audience_ambiguous_request',
            'request_id',previous_request_id
          );
        elsif previous_idempotency_key is not null
           and previous_app_id=current_app_id then
          delete from private.onesignal_predictive_push_dedupe d
          where d.organization_id=_org
            and d.ingredient_key=ingredient_key
            and d.days_remaining=days
            and d.request_id=previous_request_id;
        elsif previous_queued_at > pg_catalog.clock_timestamp() - interval '24 hours' then
          -- response_missing is ambiguous. If the App ID rotated, suppress a
          -- cross-app resend for the normal 24-hour logical-alert cooldown.
          return jsonb_build_object(
            'ok',true,
            'queued',true,
            'delivered',false,
            'pending',true,
            'deduplicated',true,
            'reason',
              case
                when previous_app_id is not null
                 and previous_app_id is distinct from current_app_id
                  then 'app_rotated_ambiguous_request'
                when previous_app_id is null
                  then 'legacy_app_ambiguous_request'
                else 'legacy_ambiguous_request'
              end,
            'request_id',previous_request_id
          );
        else
          delete from private.onesignal_predictive_push_dedupe d
          where d.organization_id=_org
            and d.ingredient_key=ingredient_key
            and d.days_remaining=days
            and d.request_id=previous_request_id;
        end if;
      end if;
    end if;
  end if;

  if predictive_idempotency_key is null then
    predictive_idempotency_key:=gen_random_uuid();
  end if;

  if subscription_ids is null then
    subscription_ids:=private.visionfood_admin_push_subscription_ids(_org);
  end if;

  if pg_catalog.jsonb_array_length(subscription_ids)=0 then
    return jsonb_build_object(
      'ok',true,
      'queued',false,
      'reason','no_admin_subscriptions'
    );
  end if;

  request_id:=public.visionfood_onesignal_queue(
    jsonb_build_object(
      'include_subscription_ids',
      subscription_ids,
      'idempotency_key',
      predictive_idempotency_key::text
    ),
    jsonb_build_object(
      'pt','🚨 Alerta de Estoque'
    ),
    jsonb_build_object(
      'pt','O item '||ing||' pode acabar em '||days||' dia(s). Veja a sugestão no painel.'
    ),
    jsonb_build_object(
      'event','predictive_stock',
      'organization_id',_org,
      'days_remaining',days
    )
  );

  if request_id is null then
    return jsonb_build_object('ok',true,'queued',false,'reason','not_configured');
  end if;

  insert into private.onesignal_predictive_push_dedupe(
    organization_id,
    ingredient_key,
    days_remaining,
    last_queued_at,
    request_id,
    last_confirmed_at,
    app_id,
    subscription_ids,
    idempotency_key
  )
  values(
    _org,
    ingredient_key,
    days,
    pg_catalog.clock_timestamp(),
    request_id,
    null,
    current_app_id,
    subscription_ids,
    predictive_idempotency_key
  )
  on conflict (organization_id,ingredient_key,days_remaining)
  do update
    set last_queued_at=excluded.last_queued_at,
        request_id=excluded.request_id,
        last_confirmed_at=null,
        app_id=excluded.app_id,
        subscription_ids=excluded.subscription_ids,
        idempotency_key=excluded.idempotency_key;

  return jsonb_build_object(
    'ok',true,
    'queued',true,
    'delivered',false,
    'pending',true,
    'deduplicated',false,
    'request_id',request_id
  );
end
$$;

revoke all on function public.visionfood_push_predictive_stock(uuid,text,integer)
  from public,anon;

grant execute on function public.visionfood_push_predictive_stock(uuid,text,integer)
  to authenticated,service_role;
