
create extension if not exists pg_net with schema extensions;

create table if not exists private.onesignal_settings (
  id text primary key default 'global',
  app_id text not null default '',
  api_key_secret_id uuid,
  updated_at timestamptz not null default now()
);

revoke all on table private.onesignal_settings
  from public,anon,authenticated;

grant select,insert,update,delete
  on table private.onesignal_settings
  to service_role;

create or replace function public.onesignal_public_config()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  c private.onesignal_settings%rowtype;
begin
  select * into c
  from private.onesignal_settings
  where id='global';

  return jsonb_build_object(
    'ok',true,
    'enabled',
      c.id is not null
      and nullif(btrim(coalesce(c.app_id,'')),'') is not null,
    'app_id',coalesce(c.app_id,'')
  );
end
$$;

revoke all on function public.onesignal_public_config()
  from public;
grant execute on function public.onesignal_public_config()
  to anon,authenticated,service_role;

create or replace function public.onesignal_admin_config()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  c private.onesignal_settings%rowtype;
begin
  if u is null or not public.eh_super_admin(u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  select * into c
  from private.onesignal_settings
  where id='global';

  return jsonb_build_object(
    'ok',true,
    'app_id',coalesce(c.app_id,''),
    'has_api_key',
      c.api_key_secret_id is not null
      and exists(
        select 1 from vault.secrets s
        where s.id=c.api_key_secret_id
      ),
    'pg_net_enabled',
      exists(select 1 from pg_extension where extname='pg_net')
  );
end
$$;

revoke all on function public.onesignal_admin_config()
  from public,anon;
grant execute on function public.onesignal_admin_config()
  to authenticated,service_role;

create or replace function public.set_onesignal_config(
  _app_id text,
  _api_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  c private.onesignal_settings%rowtype;
  sid uuid;
  app text:=btrim(coalesce(_app_id,''));
  key text:=btrim(coalesce(_api_key,''));
begin
  if u is null or not public.eh_super_admin(u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if app<>'' and app !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok',false,'reason','invalid_app_id');
  end if;

  insert into private.onesignal_settings(id,app_id,updated_at)
  values('global',app,now())
  on conflict(id) do update
    set app_id=excluded.app_id,
        updated_at=now();

  select * into c
  from private.onesignal_settings
  where id='global'
  for update;

  sid:=c.api_key_secret_id;

  if key<>'' then
    if length(key)<20 or length(key)>1000 then
      return jsonb_build_object('ok',false,'reason','invalid_api_key');
    end if;

    if sid is not null
       and exists(select 1 from vault.secrets where id=sid) then
      perform vault.update_secret(
        sid,key,null,null,null
      );
    else
      sid:=vault.create_secret(
        key,
        'onesignal_api_key::global',
        'OneSignal App API Key',
        null
      );
    end if;

    update private.onesignal_settings
       set api_key_secret_id=sid,
           updated_at=now()
     where id='global';
  end if;

  return jsonb_build_object(
    'ok',true,
    'app_id',app,
    'has_api_key',
      sid is not null
      and exists(select 1 from vault.secrets where id=sid)
  );
end
$$;

revoke all on function public.set_onesignal_config(text,text)
  from public,anon;
grant execute on function public.set_onesignal_config(text,text)
  to authenticated,service_role;

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
  select * into c
  from private.onesignal_settings
  where id='global';

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

create or replace function public.visionfood_push_delivery_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  phone text;
begin
  if new.status<>'out_for_delivery'
     or old.status is not distinct from new.status then
    return new;
  end if;

  phone:=regexp_replace(coalesce(new.customer_phone,''),'\D','','g');

  if length(phone) in (10,11)
     and left(phone,2)<>'55' then
    phone:='55'||phone;
  end if;

  if length(phone)<8 then
    return new;
  end if;

  perform public.visionfood_onesignal_queue(
    jsonb_build_object(
      'include_aliases',
      jsonb_build_object('external_id',jsonb_build_array(phone))
    ),
    jsonb_build_object(
      'pt','🚀 Seu pedido saiu!'
    ),
    jsonb_build_object(
      'pt','O motoboy iniciou a entrega e seu pedido está a caminho.'
    ),
    jsonb_build_object(
      'event','out_for_delivery',
      'order_id',new.id,
      'organization_id',new.organization_id
    )
  );

  return new;
end
$$;

revoke all on function public.visionfood_push_delivery_trigger()
  from public,anon,authenticated;

drop trigger if exists trg_visionfood_push_delivery
  on public.orders;

create trigger trg_visionfood_push_delivery
after update of status on public.orders
for each row
when (
  old.status is distinct from new.status
  and new.status='out_for_delivery'
)
execute function public.visionfood_push_delivery_trigger();

create or replace function public.visionfood_push_rupture_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if coalesce(old.estoque_atual,0)<=0
     or coalesce(new.estoque_atual,0)>0 then
    return new;
  end if;

  perform public.visionfood_onesignal_queue(
    jsonb_build_object(
      'filters',
      jsonb_build_array(
        jsonb_build_object(
          'field','tag','key','tipo','relation','=','value','admin'
        ),
        jsonb_build_object('operator','AND'),
        jsonb_build_object(
          'field','tag','key','organization_id','relation','=','value',new.organization_id::text
        )
      )
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

drop trigger if exists trg_visionfood_push_rupture
  on public.ingredientes;

create trigger trg_visionfood_push_rupture
after update of estoque_atual on public.ingredientes
for each row
when (
  old.estoque_atual>0
  and new.estoque_atual<=0
)
execute function public.visionfood_push_rupture_trigger();

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
  days int:=greatest(1,least(coalesce(_days_remaining,1),365));
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

  return jsonb_build_object(
    'ok',true,
    'queued',true,
    'request_id',request_id
  );
end
$$;

revoke all on function public.visionfood_push_predictive_stock(uuid,text,integer)
  from public,anon;
grant execute on function public.visionfood_push_predictive_stock(uuid,text,integer)
  to authenticated,service_role;
