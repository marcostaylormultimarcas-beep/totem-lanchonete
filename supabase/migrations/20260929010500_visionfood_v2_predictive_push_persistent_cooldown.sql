create table if not exists private.onesignal_predictive_push_dedupe (
  organization_id uuid not null,
  ingredient_key text not null,
  days_remaining integer not null,
  last_queued_at timestamptz not null,
  request_id bigint not null,
  primary key (organization_id, ingredient_key, days_remaining),
  constraint onesignal_predictive_push_dedupe_days_chk
    check (days_remaining between 1 and 365)
);

revoke all on table private.onesignal_predictive_push_dedupe
  from public,anon,authenticated;

grant select,insert,update,delete
  on table private.onesignal_predictive_push_dedupe
  to service_role;

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

  request_id:=public.visionfood_onesignal_queue(
    jsonb_build_object(
      'filters',
      jsonb_build_array(
        jsonb_build_object(
          'field','tag','key','tipo','relation','=','value','admin'
        ),
        jsonb_build_object('operator','AND'),
        jsonb_build_object(
          'field','tag','key','organization_id','relation','=','value',_org::text
        )
      )
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
