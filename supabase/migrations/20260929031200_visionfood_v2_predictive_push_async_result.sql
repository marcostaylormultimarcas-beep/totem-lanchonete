-- Reconcile the asynchronous pg_net result before a predictive push is
-- considered delivered or eligible for the 24-hour cooldown.

alter table private.onesignal_predictive_push_dedupe
  add column if not exists last_confirmed_at timestamptz;

create index if not exists onesignal_predictive_push_dedupe_request_idx
  on private.onesignal_predictive_push_dedupe(request_id);

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
  response_status integer;
  response_timed_out boolean;
  response_error text;
  still_queued boolean:=false;
  advisory_key bigint;
  subscription_ids jsonb;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  if not private.usuario_dono_org(_org,u) then
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

  select d.request_id,d.last_queued_at,d.last_confirmed_at
    into previous_request_id,previous_queued_at,previous_confirmed_at
  from private.onesignal_predictive_push_dedupe d
  where d.organization_id=_org
    and d.ingredient_key=ingredient_key
    and d.days_remaining=days;

  if found then
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

    select r.status_code,r.timed_out,r.error_msg
      into response_status,response_timed_out,response_error
    from net._http_response r
    where r.id=previous_request_id
    order by r.created desc
    limit 1;

    if found then
      if response_status>=200
         and response_status<300
         and not coalesce(response_timed_out,false)
         and nullif(btrim(coalesce(response_error,'')),'') is null then
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

      delete from private.onesignal_predictive_push_dedupe d
      where d.organization_id=_org
        and d.ingredient_key=ingredient_key
        and d.days_remaining=days
        and d.request_id=previous_request_id;
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

      delete from private.onesignal_predictive_push_dedupe d
      where d.organization_id=_org
        and d.ingredient_key=ingredient_key
        and d.days_remaining=days
        and d.request_id=previous_request_id;
    end if;
  end if;

  subscription_ids:=private.visionfood_admin_push_subscription_ids(_org);

  if jsonb_array_length(subscription_ids)=0 then
    return jsonb_build_object(
      'ok',true,
      'queued',false,
      'reason','no_admin_subscriptions'
    );
  end if;

  request_id:=public.visionfood_onesignal_queue(
    jsonb_build_object(
      'include_subscription_ids',
      subscription_ids
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
    last_confirmed_at
  )
  values(
    _org,
    ingredient_key,
    days,
    pg_catalog.clock_timestamp(),
    request_id,
    null
  )
  on conflict (organization_id,ingredient_key,days_remaining)
  do update
    set last_queued_at=excluded.last_queued_at,
        request_id=excluded.request_id,
        last_confirmed_at=null;

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
  response_status integer;
  response_timed_out boolean;
  response_error text;
  still_queued boolean:=false;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  if not private.usuario_dono_org(_org,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if _request_id is null or _request_id<=0 then
    return jsonb_build_object('ok',false,'reason','invalid_request_id');
  end if;

  select d.last_queued_at,d.last_confirmed_at
    into queued_at,confirmed_at
  from private.onesignal_predictive_push_dedupe d
  where d.organization_id=_org
    and d.request_id=_request_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','unknown_request');
  end if;

  if confirmed_at is not null then
    return jsonb_build_object(
      'ok',true,
      'delivered',true,
      'pending',false,
      'request_id',_request_id
    );
  end if;

  select r.status_code,r.timed_out,r.error_msg
    into response_status,response_timed_out,response_error
  from net._http_response r
  where r.id=_request_id
  order by r.created desc
  limit 1;

  if found then
    if response_status>=200
       and response_status<300
       and not coalesce(response_timed_out,false)
       and nullif(btrim(coalesce(response_error,'')),'') is null then
      update private.onesignal_predictive_push_dedupe d
         set last_confirmed_at=pg_catalog.clock_timestamp()
       where d.organization_id=_org
         and d.request_id=_request_id;

      return jsonb_build_object(
        'ok',true,
        'delivered',true,
        'pending',false,
        'request_id',_request_id
      );
    end if;

    delete from private.onesignal_predictive_push_dedupe d
    where d.organization_id=_org
      and d.request_id=_request_id;

    return jsonb_build_object(
      'ok',true,
      'delivered',false,
      'pending',false,
      'failed',true,
      'reason','http_failure',
      'status_code',response_status,
      'request_id',_request_id
    );
  end if;

  select exists(
    select 1
    from net.http_request_queue q
    where q.id=_request_id
  )
  into still_queued;

  if still_queued
     or queued_at > pg_catalog.clock_timestamp() - interval '15 seconds' then
    return jsonb_build_object(
      'ok',true,
      'delivered',false,
      'pending',true,
      'request_id',_request_id
    );
  end if;

  delete from private.onesignal_predictive_push_dedupe d
  where d.organization_id=_org
    and d.request_id=_request_id;

  return jsonb_build_object(
    'ok',true,
    'delivered',false,
    'pending',false,
    'failed',true,
    'reason','response_missing',
    'request_id',_request_id
  );
end
$$;

revoke all on function public.visionfood_predictive_push_result(uuid,bigint)
  from public,anon;

grant execute on function public.visionfood_predictive_push_result(uuid,bigint)
  to authenticated,service_role;
