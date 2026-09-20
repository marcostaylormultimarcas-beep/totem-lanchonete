-- PHASE 290: commercial readiness — shared tables + offline-safe checkout idempotency.
-- Branch-only migration. Do not apply remotely during this phase.

create schema if not exists private;

create table if not exists private.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  public_token uuid not null default gen_random_uuid(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_tables_label_length check (char_length(btrim(label)) between 1 and 40),
  unique (organization_id, label),
  unique (public_token)
);

create table if not exists private.table_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  table_id uuid not null references private.restaurant_tables(id) on delete restrict,
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint table_sessions_status_check check (status in ('open','closed'))
);

create unique index if not exists table_sessions_one_open_per_table_idx
  on private.table_sessions(table_id)
  where status='open';

create index if not exists restaurant_tables_org_idx
  on private.restaurant_tables(organization_id, active, label);

create unique index if not exists restaurant_tables_org_label_normalized_uidx
  on private.restaurant_tables(organization_id, lower(btrim(label)));

create index if not exists table_sessions_org_idx
  on private.table_sessions(organization_id, status, opened_at desc);

revoke all on table private.restaurant_tables from public, anon, authenticated;
revoke all on table private.table_sessions from public, anon, authenticated;
grant all on table private.restaurant_tables to service_role;
grant all on table private.table_sessions to service_role;

alter table public.orders
  add column if not exists table_id uuid,
  add column if not exists table_session_id uuid,
  add column if not exists table_label text not null default '',
  add column if not exists client_request_id uuid;

alter table public.orders
  add constraint orders_table_id_fkey
    foreign key (table_id) references private.restaurant_tables(id) on delete restrict,
  add constraint orders_table_session_id_fkey
    foreign key (table_session_id) references private.table_sessions(id) on delete restrict;

create unique index if not exists orders_org_client_request_uidx
  on public.orders(organization_id, client_request_id)
  where client_request_id is not null;

create index if not exists orders_org_table_session_idx
  on public.orders(organization_id, table_session_id, created_at desc)
  where table_session_id is not null;

create or replace function public.visionfood_public_table_context(
  _organization_id uuid,
  _table_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  t private.restaurant_tables%rowtype;
  accepts_table boolean;
begin
  if _organization_id is null or _table_token is null then
    return jsonb_build_object('ok',false);
  end if;

  if coalesce(
    (public.visionfood_public_organization(_organization_id,null)->>'paused')::boolean,
    true
  ) then
    return jsonb_build_object('ok',false);
  end if;

  select coalesce(c.aceita_mesa,true)
    into accepts_table
  from public.organizations o
  left join public.configuracoes c on c.organization_id=o.id
  where o.id=_organization_id
  limit 1;

  if coalesce(accepts_table,false) is not true then
    return jsonb_build_object('ok',false);
  end if;

  select *
    into t
  from private.restaurant_tables rt
  where rt.organization_id=_organization_id
    and rt.public_token=_table_token
    and rt.active=true
  limit 1;

  if not found then
    return jsonb_build_object('ok',false);
  end if;

  return jsonb_build_object(
    'ok',true,
    'label',t.label
  );
end
$function$;

revoke all on function public.visionfood_public_table_context(uuid,uuid) from public;
grant execute on function public.visionfood_public_table_context(uuid,uuid) to anon, authenticated, service_role;

create or replace function public.visionfood_admin_tables(_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  result jsonb;
begin
  if auth.uid() is null or not private.usuario_dono_org(_org,auth.uid()) then
    raise exception 'forbidden';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',t.id,
        'label',t.label,
        'public_token',t.public_token,
        'active',t.active,
        'open_session_id',s.id,
        'open_session_started_at',s.opened_at,
        'open_orders',coalesce(x.open_orders,0),
        'open_total',coalesce(x.open_total,0)
      )
      order by t.label
    ),
    '[]'::jsonb
  )
  into result
  from private.restaurant_tables t
  left join private.table_sessions s
    on s.table_id=t.id and s.status='open'
  left join lateral (
    select
      count(*) filter (where o.status<>'cancelled')::integer as open_orders,
      coalesce(sum(o.total) filter (where o.status<>'cancelled'),0) as open_total
    from public.orders o
    where o.organization_id=_org
      and o.table_session_id=s.id
  ) x on true
  where t.organization_id=_org;

  return result;
end
$function$;

revoke all on function public.visionfood_admin_tables(uuid) from public, anon;
grant execute on function public.visionfood_admin_tables(uuid) to authenticated, service_role;

create or replace function public.visionfood_upsert_table(
  _org uuid,
  _label text,
  _table_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  t private.restaurant_tables%rowtype;
  normalized_label text;
begin
  if auth.uid() is null or not private.usuario_dono_org(_org,auth.uid()) then
    raise exception 'forbidden';
  end if;

  normalized_label:=btrim(coalesce(_label,''));
  if char_length(normalized_label)<1 or char_length(normalized_label)>40 then
    raise exception 'invalid_table_label';
  end if;

  if _table_id is null then
    insert into private.restaurant_tables(organization_id,label)
    values(_org,normalized_label)
    returning * into t;
  else
    update private.restaurant_tables
       set label=normalized_label,updated_at=now()
     where id=_table_id and organization_id=_org
    returning * into t;
    if not found then raise exception 'table_not_found'; end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'id',t.id,
    'label',t.label,
    'public_token',t.public_token,
    'active',t.active
  );
end
$function$;

revoke all on function public.visionfood_upsert_table(uuid,text,uuid) from public, anon;
grant execute on function public.visionfood_upsert_table(uuid,text,uuid) to authenticated, service_role;

create or replace function public.visionfood_rotate_table_token(
  _org uuid,
  _table_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  t private.restaurant_tables%rowtype;
begin
  if auth.uid() is null or not private.usuario_dono_org(_org,auth.uid()) then
    raise exception 'forbidden';
  end if;

  update private.restaurant_tables
     set public_token=extensions.gen_random_uuid(),updated_at=now()
   where id=_table_id and organization_id=_org
  returning * into t;

  if not found then raise exception 'table_not_found'; end if;
  return jsonb_build_object('ok',true,'id',t.id,'public_token',t.public_token);
end
$function$;

revoke all on function public.visionfood_rotate_table_token(uuid,uuid) from public, anon;
grant execute on function public.visionfood_rotate_table_token(uuid,uuid) to authenticated, service_role;

create or replace function public.create_order_checkout_v4(
  _organization_id uuid,
  _customer_name text,
  _customer_phone text default '',
  _customer_cpf text default '',
  _order_type text default 'local',
  _delivery_address text default '',
  _delivery_reference text default '',
  _delivery_recipient text default '',
  _bairro_id uuid default null,
  _bairro_nome text default '',
  _delivery_fee numeric default 0,
  _items jsonb default '[]'::jsonb,
  _total numeric default 0,
  _payment_method text default '',
  _scheduled_for timestamptz default null,
  _coupon_code text default '',
  _delivery_context jsonb default '{}'::jsonb,
  _table_token uuid default null,
  _client_request_id uuid default null
)
returns table(
  id uuid,
  order_number text,
  delivery_code text,
  table_label text,
  table_session_id uuid,
  idempotent boolean
)
language plpgsql
security definer
set search_path=''
as $function$
declare
  existing public.orders%rowtype;
  t private.restaurant_tables%rowtype;
  sess private.table_sessions%rowtype;
  created record;
  accepts_table boolean;
  uid uuid;
begin
  uid:=auth.uid();
  if uid is null then raise exception 'authentication_required'; end if;
  if _organization_id is null or _client_request_id is null then
    raise exception 'invalid_checkout_request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'visionfood:checkout-request:'||_organization_id::text||':'||_client_request_id::text,
      0
    )
  );

  select *
    into existing
  from public.orders o
  where o.organization_id=_organization_id
    and o.client_request_id=_client_request_id
  limit 1
  for update;

  if found then
    if existing.user_id is distinct from uid then raise exception 'checkout_request_conflict'; end if;
    return query
    select existing.id,existing.order_number,coalesce(existing.delivery_code,''),
           coalesce(existing.table_label,''),existing.table_session_id,true;
    return;
  end if;

  if _table_token is not null then
    if _order_type<>'local' then raise exception 'table_requires_local_order'; end if;

    select coalesce(c.aceita_mesa,true)
      into accepts_table
    from public.organizations o
    left join public.configuracoes c on c.organization_id=o.id
    where o.id=_organization_id
    limit 1;

    if coalesce(accepts_table,false) is not true then raise exception 'table_orders_disabled'; end if;

    select *
      into t
    from private.restaurant_tables rt
    where rt.organization_id=_organization_id
      and rt.public_token=_table_token
      and rt.active=true
    limit 1;

    if not found then raise exception 'invalid_table_token'; end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('visionfood:table-session:'||t.id::text,0)
    );

    select *
      into sess
    from private.table_sessions ts
    where ts.table_id=t.id and ts.status='open'
    limit 1
    for update;

    if not found then
      insert into private.table_sessions(organization_id,table_id)
      values(_organization_id,t.id)
      returning * into sess;
    end if;
  end if;

  select *
    into created
  from public.create_order_checkout_v3(
    _organization_id,_customer_name,_customer_phone,_customer_cpf,_order_type,
    _delivery_address,_delivery_reference,_delivery_recipient,_bairro_id,_bairro_nome,
    _delivery_fee,_items,_total,_payment_method,_scheduled_for,_coupon_code,_delivery_context
  );

  if created.id is null then raise exception 'checkout_create_failed'; end if;

  update public.orders o
     set client_request_id=_client_request_id,
         table_id=case when _table_token is null then null else t.id end,
         table_session_id=case when _table_token is null then null else sess.id end,
         table_label=case when _table_token is null then '' else t.label end,
         updated_at=now()
   where o.id=created.id
     and o.organization_id=_organization_id;

  return query
  select created.id::uuid,created.order_number::text,coalesce(created.delivery_code,'')::text,
         case when _table_token is null then '' else t.label end,
         case when _table_token is null then null else sess.id end,
         false;
end
$function$;

revoke all on function public.create_order_checkout_v4(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb,uuid,uuid
) from public, anon;
grant execute on function public.create_order_checkout_v4(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb,uuid,uuid
) to authenticated, service_role;

create or replace function public.visionfood_close_table_session(_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  s private.table_sessions%rowtype;
  blocking_count integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select *
    into s
  from private.table_sessions ts
  where ts.id=_session_id
  for update;

  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if not private.usuario_dono_org(s.organization_id,auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  if s.status='closed' then return jsonb_build_object('ok',true,'already_closed',true); end if;

  select count(*)::integer
    into blocking_count
  from public.orders o
  where o.table_session_id=s.id
    and o.status<>'cancelled'
    and (
      o.status<>'delivered'
      or coalesce(o.payment_status,'pending')<>'paid'
    );

  if blocking_count>0 then
    return jsonb_build_object(
      'ok',false,
      'reason','open_orders',
      'blocking_orders',blocking_count
    );
  end if;

  update private.table_sessions
     set status='closed',closed_at=now(),updated_at=now()
   where id=s.id;

  return jsonb_build_object('ok',true,'session_id',s.id);
end
$function$;

revoke all on function public.visionfood_close_table_session(uuid) from public, anon;
grant execute on function public.visionfood_close_table_session(uuid) to authenticated, service_role;
