create table if not exists private.onesignal_admin_push_subscriptions (
  subscription_id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint onesignal_admin_push_subscription_id_chk
    check (
      char_length(subscription_id) between 1 and 255
      and subscription_id = btrim(subscription_id)
    )
);

revoke all on table private.onesignal_admin_push_subscriptions
  from public,anon,authenticated;

grant select,insert,update,delete
  on table private.onesignal_admin_push_subscriptions
  to service_role;

create index if not exists onesignal_admin_push_subscriptions_org_idx
  on private.onesignal_admin_push_subscriptions(organization_id);

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
  sid text:=btrim(coalesce(_subscription_id,''));
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

  insert into private.onesignal_admin_push_subscriptions(
    subscription_id,
    organization_id,
    user_id,
    updated_at
  )
  values(
    sid,
    _org,
    u,
    pg_catalog.clock_timestamp()
  )
  on conflict (subscription_id)
  do update
    set organization_id=excluded.organization_id,
        user_id=excluded.user_id,
        updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true);
end
$$;

revoke all on function public.visionfood_register_admin_push_subscription(uuid,text)
  from public,anon;

grant execute on function public.visionfood_register_admin_push_subscription(uuid,text)
  to authenticated;

create or replace function public.visionfood_unregister_admin_push_subscription(
  _subscription_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  sid text:=btrim(coalesce(_subscription_id,''));
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  if sid='' or length(sid)>255 then
    return jsonb_build_object('ok',false,'reason','invalid_subscription');
  end if;

  delete from private.onesignal_admin_push_subscriptions
  where subscription_id=sid
    and user_id=u;

  return jsonb_build_object('ok',true);
end
$$;

revoke all on function public.visionfood_unregister_admin_push_subscription(text)
  from public,anon;

grant execute on function public.visionfood_unregister_admin_push_subscription(text)
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
    and private.usuario_dono_org(_org,s.user_id);
$$;

revoke all on function private.visionfood_admin_push_subscription_ids(uuid)
  from public,anon,authenticated;

grant execute on function private.visionfood_admin_push_subscription_ids(uuid)
  to service_role;

create or replace function public.visionfood_push_rupture_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  subscription_ids jsonb;
begin
  if coalesce(old.estoque_atual,0)<=0
     or coalesce(new.estoque_atual,0)>0 then
    return new;
  end if;

  subscription_ids:=private.visionfood_admin_push_subscription_ids(
    new.organization_id
  );

  if jsonb_array_length(subscription_ids)=0 then
    return new;
  end if;

  perform public.visionfood_onesignal_queue(
    jsonb_build_object(
      'include_subscription_ids',
      subscription_ids
    ),
    jsonb_build_object(
      'pt','🚨 Ruptura de Estoque'
    ),
    jsonb_build_object(
      'pt','O ingrediente "'||left(coalesce(new.nome,'Ingrediente'),120)||'" zerou. Verifique o estoque no painel.'
    ),
    jsonb_build_object(
      'event','stock_rupture',
      'ingredient_id',new.id,
      'organization_id',new.organization_id
    )
  );

  return new;
end
$$;

revoke all on function public.visionfood_push_rupture_trigger()
  from public,anon,authenticated;

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

  select d.request_id,d.last_queued_at
    into previous_request_id,previous_queued_at
  from private.onesignal_predictive_push_dedupe d
  where d.organization_id=_org
    and d.ingredient_key=ingredient_key
    and d.days_remaining=days;

  if found
     and previous_queued_at > pg_catalog.clock_timestamp() - interval '24 hours' then
    return jsonb_build_object(
      'ok',true,
      'queued',true,
      'deduplicated',true,
      'request_id',previous_request_id
    );
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
    request_id
  )
  values(
    _org,
    ingredient_key,
    days,
    pg_catalog.clock_timestamp(),
    request_id
  )
  on conflict (organization_id,ingredient_key,days_remaining)
  do update
    set last_queued_at=excluded.last_queued_at,
        request_id=excluded.request_id;

  return jsonb_build_object(
    'ok',true,
    'queued',true,
    'deduplicated',false,
    'request_id',request_id
  );
end
$$;

revoke all on function public.visionfood_push_predictive_stock(uuid,text,integer)
  from public,anon;

grant execute on function public.visionfood_push_predictive_stock(uuid,text,integer)
  to authenticated,service_role;
