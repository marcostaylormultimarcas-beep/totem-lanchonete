-- PHASE 293: commercial readiness — authoritative offline device sync + reconciliation.
-- Branch-only migration. Do not apply remotely during this phase.
--
-- Contract:
-- - offline orders are device-owned guests; no customer JWT is accepted here;
-- - authoritative idempotency key is (device_id, client_request_id);
-- - local_order_id is diagnostic only;
-- - raw device credential is verified against the PHASE 292 hash and never stored;
-- - only cash/pending offline orders may synchronize;
-- - catalog/pricing/delivery/coupon/table/stock rules are revalidated on the server;
-- - Vision Prime is not inherited without a separate authenticated customer proof flow;
-- - material commercial divergence becomes needs_attention and creates no order;
-- - a successful replay returns the same authoritative order and never repeats INSERT side effects.

create schema if not exists private;

create table if not exists private.kiosk_order_syncs (
  id uuid primary key default extensions.gen_random_uuid(),
  device_id uuid not null references private.kiosk_devices(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_request_id uuid not null,
  local_order_id uuid,
  request_hash bytea not null,
  state text not null default 'syncing',
  order_id uuid references public.orders(id) on delete restrict,
  conflict_reason text,
  attempt_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  synced_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint kiosk_order_syncs_state_check
    check (state in ('syncing','synced','needs_attention')),
  constraint kiosk_order_syncs_attempt_count_positive
    check (attempt_count > 0),
  unique (device_id, client_request_id)
);

create index if not exists kiosk_order_syncs_org_state_idx
  on private.kiosk_order_syncs(organization_id, state, updated_at desc);

alter table private.kiosk_order_syncs enable row level security;
revoke all on table private.kiosk_order_syncs from public, anon, authenticated;
grant all on table private.kiosk_order_syncs to service_role;

alter table public.orders
  add column if not exists kiosk_device_id uuid;

alter table public.orders
  add constraint orders_kiosk_device_id_fkey
    foreign key (kiosk_device_id) references private.kiosk_devices(id) on delete restrict;

-- PHASE 290 used organization_id + client_request_id because v4 represented
-- authenticated browser checkout. PHASE 293 gives device-owned orders their own
-- namespace so two kiosks may legitimately generate the same UUID.
drop index if exists public.orders_org_client_request_uidx;

create unique index if not exists orders_authenticated_client_request_uidx
  on public.orders(organization_id, client_request_id)
  where client_request_id is not null
    and kiosk_device_id is null;

create unique index if not exists orders_device_client_request_uidx
  on public.orders(kiosk_device_id, client_request_id)
  where kiosk_device_id is not null
    and client_request_id is not null;

create index if not exists orders_kiosk_device_idx
  on public.orders(organization_id, kiosk_device_id, created_at desc)
  where kiosk_device_id is not null;

-- Preserve the authenticated PHASE 290 path, but keep its idempotency lookup
-- inside the authenticated namespace so it cannot collide with a device order.
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
    and o.kiosk_device_id is null
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

create or replace function public.visionfood_sync_kiosk_order(
  _device_id uuid,
  _credential text,
  _client_request_id uuid,
  _local_order_id uuid,
  _payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  d private.kiosk_devices%rowtype;
  sync_row private.kiosk_order_syncs%rowtype;
  existing_order public.orders%rowtype;
  created record;
  t private.restaurant_tables%rowtype;
  sess private.table_sessions%rowtype;
  accepts_table boolean;
  credential_hash bytea;
  canonical_items jsonb;
  canonical_request jsonb;
  request_hash bytea;
  quote jsonb;
  snapshot jsonb;
  expected_subtotal numeric;
  expected_coupon_discount numeric;
  expected_delivery_fee numeric;
  expected_total numeric;
  current_subtotal numeric;
  current_coupon_discount numeric;
  current_delivery_fee numeric;
  current_total numeric;
  payload_org uuid;
  bairro_id uuid;
  table_token uuid;
  scheduled_for timestamptz;
  bairro_nome text:='';
  conflict_message text;
  conflict_state text;
  conflict_code text;
  sql_state text;
begin
  -- A customer JWT must never be silently converted into device ownership.
  if auth.uid() is not null then
    return jsonb_build_object(
      'ok',false,
      'state','needs_attention',
      'reason','customer_auth_not_allowed_for_device_sync'
    );
  end if;

  if _device_id is null
     or _client_request_id is null
     or _local_order_id is null
     or _payload is null
     or jsonb_typeof(_payload)<>'object'
     or coalesce(_credential,'') !~ '^[0-9a-fA-F]{64}$' then
    return jsonb_build_object(
      'ok',false,
      'state','needs_attention',
      'reason','invalid_sync_request'
    );
  end if;

  credential_hash:=extensions.digest(_credential,'sha256');

  select *
    into d
  from private.kiosk_devices x
  where x.id=_device_id
    and x.credential_hash=credential_hash
    and x.active=true
    and x.revoked_at is null
  for update;

  if not found then
    return jsonb_build_object(
      'ok',false,
      'state','needs_attention',
      'reason','invalid_device'
    );
  end if;

  begin
    payload_org:=nullif(_payload->>'organization_id','')::uuid;
  exception when invalid_text_representation then
    payload_org:=null;
  end;

  if payload_org is distinct from d.organization_id then
    return jsonb_build_object(
      'ok',false,
      'state','needs_attention',
      'reason','organization_mismatch',
      'device_id',d.id,
      'client_request_id',_client_request_id
    );
  end if;

  if lower(btrim(coalesce(_payload->>'payment_method','')))<>'cash'
     or lower(btrim(coalesce(_payload->>'payment_status','pending')))='paid'
     or lower(btrim(coalesce(_payload->>'ownership','device_guest')))<> 'device_guest' then
    return jsonb_build_object(
      'ok',false,
      'state','needs_attention',
      'reason','offline_payment_contract_violation',
      'device_id',d.id,
      'client_request_id',_client_request_id
    );
  end if;

  if jsonb_typeof(coalesce(_payload->'items','null'::jsonb))<>'array' then
    return jsonb_build_object(
      'ok',false,
      'state','needs_attention',
      'reason','invalid_items',
      'device_id',d.id,
      'client_request_id',_client_request_id
    );
  end if;

  -- Strip all client price/name/line-total fields. Only customer choices are
  -- retained; server checkout resolves the current commercial values.
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'product_id',nullif(i.value->>'product_id',''),
          'quantity',coalesce(nullif(i.value->>'quantity',''),'1'),
          'extras',coalesce(i.value->'extras','[]'::jsonb),
          'removedIngredients',coalesce(i.value->'removedIngredients','[]'::jsonb),
          'weight_kg',nullif(i.value->>'weight_kg','')
        )
      )
      order by i.ordinality
    ),
    '[]'::jsonb
  )
  into canonical_items
  from jsonb_array_elements(_payload->'items') with ordinality as i(value,ordinality);

  canonical_request:=jsonb_build_object(
    'organization_id',d.organization_id,
    'customer_name',btrim(coalesce(_payload->>'customer_name','')),
    'customer_phone',regexp_replace(coalesce(_payload->>'customer_phone',''),'[^0-9]','','g'),
    'customer_cpf',btrim(coalesce(_payload->>'customer_cpf','')),
    'order_type',lower(btrim(coalesce(_payload->>'order_type','local'))),
    'delivery_address',btrim(coalesce(_payload->>'delivery_address','')),
    'delivery_reference',btrim(coalesce(_payload->>'delivery_reference','')),
    'delivery_recipient',btrim(coalesce(_payload->>'delivery_recipient','')),
    'bairro_id',nullif(_payload->>'bairro_id',''),
    'items',canonical_items,
    'payment_method','cash',
    'scheduled_for',nullif(_payload->>'scheduled_for',''),
    'coupon_code',upper(btrim(coalesce(_payload->>'coupon_code',''))),
    'delivery_context',coalesce(_payload->'delivery_context','{}'::jsonb),
    'table_token',nullif(_payload->>'table_token',''),
    'offline_snapshot',coalesce(_payload->'offline_snapshot','{}'::jsonb)
  );
  request_hash:=extensions.digest(canonical_request::text,'sha256');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'visionfood:kiosk-sync:'||d.id::text||':'||_client_request_id::text,
      0
    )
  );

  select *
    into sync_row
  from private.kiosk_order_syncs s
  where s.device_id=d.id
    and s.client_request_id=_client_request_id
  for update;

  if found then
    update private.kiosk_order_syncs s
       set attempt_count=s.attempt_count+1,
           last_attempt_at=now(),
           updated_at=now()
     where s.id=sync_row.id;

    if sync_row.request_hash<>request_hash then
      if sync_row.state<>'synced' then
        update private.kiosk_order_syncs s
           set state='needs_attention',
               conflict_reason='idempotency_payload_mismatch',
               updated_at=now()
         where s.id=sync_row.id;
      end if;
      return jsonb_build_object(
        'ok',false,
        'state','needs_attention',
        'reason','idempotency_payload_mismatch',
        'device_id',d.id,
        'client_request_id',_client_request_id,
        'order_id',sync_row.order_id
      );
    end if;

    if sync_row.state='needs_attention' then
      return jsonb_build_object(
        'ok',false,
        'state','needs_attention',
        'reason',coalesce(sync_row.conflict_reason,'needs_attention'),
        'device_id',d.id,
        'client_request_id',_client_request_id,
        'order_id',sync_row.order_id
      );
    end if;

    if sync_row.state='synced' and sync_row.order_id is not null then
      select *
        into existing_order
      from public.orders o
      where o.id=sync_row.order_id
        and o.kiosk_device_id=d.id
        and o.client_request_id=_client_request_id
      limit 1;

      if not found then
        raise exception 'kiosk_sync_integrity_error';
      end if;

      update private.kiosk_devices
         set last_seen_at=now(),updated_at=now()
       where id=d.id;

      return jsonb_build_object(
        'ok',true,
        'state','synced',
        'idempotent',true,
        'device_id',d.id,
        'client_request_id',_client_request_id,
        'order_id',existing_order.id,
        'order_number',existing_order.order_number,
        'delivery_code',coalesce(existing_order.delivery_code,''),
        'total',existing_order.total,
        'payment_method',existing_order.payment_method,
        'payment_status',coalesce(existing_order.payment_status,'pending'),
        'table_label',coalesce(existing_order.table_label,''),
        'table_session_id',existing_order.table_session_id
      );
    end if;
  else
    insert into private.kiosk_order_syncs(
      device_id,organization_id,client_request_id,local_order_id,request_hash,state
    )
    values(
      d.id,d.organization_id,_client_request_id,_local_order_id,request_hash,'syncing'
    )
    returning * into sync_row;
  end if;

  begin
    if jsonb_typeof(coalesce(_payload->'offline_snapshot','null'::jsonb))<>'object' then
      raise exception 'offline_snapshot_invalid';
    end if;

    snapshot:=_payload->'offline_snapshot';

    if nullif(snapshot->>'displayed_total','') is null
       or nullif(snapshot->>'displayed_subtotal','') is null
       or nullif(snapshot->>'displayed_coupon_discount','') is null
       or nullif(snapshot->>'displayed_delivery_fee','') is null then
      raise exception 'offline_snapshot_missing';
    end if;

    expected_total:=(snapshot->>'displayed_total')::numeric;
    expected_subtotal:=(snapshot->>'displayed_subtotal')::numeric;
    expected_coupon_discount:=(snapshot->>'displayed_coupon_discount')::numeric;
    expected_delivery_fee:=(snapshot->>'displayed_delivery_fee')::numeric;

    if expected_total<0
       or expected_subtotal<0
       or expected_coupon_discount<0
       or expected_delivery_fee<0 then
      raise exception 'offline_snapshot_invalid';
    end if;

    if coalesce(nullif(snapshot->>'prime_discount','')::numeric,0)>0
       or coalesce((snapshot->>'prime_shipping_waived')::boolean,false) then
      raise exception 'customer_benefit_requires_authentication';
    end if;

    if lower(btrim(coalesce(canonical_request->>'order_type',''))) not in ('local','viagem','delivery') then
      raise exception 'invalid_order_type';
    end if;

    if nullif(canonical_request->>'scheduled_for','') is not null then
      -- PHASE 274 documented that scheduled opening-hours validation is not
      -- available in the current quote contract. Fail closed rather than guess.
      raise exception 'offline_scheduled_order_requires_review';
    end if;

    begin
      bairro_id:=nullif(canonical_request->>'bairro_id','')::uuid;
      table_token:=nullif(canonical_request->>'table_token','')::uuid;
      scheduled_for:=nullif(canonical_request->>'scheduled_for','')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid_checkout_payload';
    end;

    -- Lock the organization and selected product rows before quote + create so
    -- the authoritative commercial snapshot cannot drift inside this sync tx.
    perform 1
    from public.organizations o
    where o.id=d.organization_id
    for share;

    if not found then raise exception 'organization_unavailable'; end if;

    perform p.id
    from public.products p
    join (
      select distinct nullif(x->>'product_id','')::uuid as product_id
      from jsonb_array_elements(canonical_items) x
    ) requested on requested.product_id=p.id
    where p.organization_id=d.organization_id
    order by p.id
    for update of p;

    if exists(
      select 1
      from jsonb_array_elements(canonical_items) x
      left join public.products p
        on p.id=nullif(x->>'product_id','')::uuid
       and p.organization_id=d.organization_id
      where p.id is null
         or coalesce(p.available,true) is not true
         or coalesce(p.ingredient_stock_blocked,false) is true
    ) then
      raise exception 'product_unavailable_or_ingredient_blocked';
    end if;

    if nullif(canonical_request->>'coupon_code','') is not null then
      perform c.id
      from public.cupons c
      where c.organization_id=d.organization_id
        and upper(c.codigo)=upper(canonical_request->>'coupon_code')
      limit 1
      for share;
    end if;

    if bairro_id is not null then
      select coalesce(te.nome_bairro,'')
        into bairro_nome
      from public.taxas_entrega te
      where te.id=bairro_id
        and te.organization_id=d.organization_id
        and te.ativo=true
      limit 1
      for share;

      if not found then raise exception 'delivery_bairro_unavailable'; end if;
    end if;

    if table_token is not null then
      if canonical_request->>'order_type'<>'local' then
        raise exception 'table_requires_local_order';
      end if;

      select coalesce(c.aceita_mesa,true)
        into accepts_table
      from public.organizations o
      left join public.configuracoes c on c.organization_id=o.id
      where o.id=d.organization_id
      limit 1;

      if coalesce(accepts_table,false) is not true then
        raise exception 'table_orders_disabled';
      end if;

      select *
        into t
      from private.restaurant_tables rt
      where rt.organization_id=d.organization_id
        and rt.public_token=table_token
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
        values(d.organization_id,t.id)
        returning * into sess;
      end if;
    end if;

    quote:=public.quote_order_checkout_v2(
      d.organization_id,
      canonical_request->>'order_type',
      bairro_id,
      0,
      canonical_items,
      canonical_request->>'coupon_code',
      canonical_request->'delivery_context'
    );

    current_subtotal:=coalesce((quote->>'subtotal')::numeric,0);
    current_coupon_discount:=coalesce((quote->>'coupon_discount')::numeric,0);
    current_delivery_fee:=coalesce((quote->>'delivery_fee')::numeric,0);
    current_total:=coalesce((quote->>'total')::numeric,0);

    if abs(expected_subtotal-current_subtotal)>0.01
       or abs(expected_coupon_discount-current_coupon_discount)>0.01
       or abs(expected_delivery_fee-current_delivery_fee)>0.01
       or abs(expected_total-current_total)>0.01 then
      raise exception 'commercial_terms_changed';
    end if;

    select *
      into created
    from public.create_order_checkout_v3(
      d.organization_id,
      canonical_request->>'customer_name',
      canonical_request->>'customer_phone',
      canonical_request->>'customer_cpf',
      canonical_request->>'order_type',
      canonical_request->>'delivery_address',
      canonical_request->>'delivery_reference',
      canonical_request->>'delivery_recipient',
      bairro_id,
      bairro_nome,
      0,
      canonical_items,
      0,
      'cash',
      scheduled_for,
      canonical_request->>'coupon_code',
      canonical_request->'delivery_context'
    );

    if created.id is null then raise exception 'checkout_create_failed'; end if;

    update public.orders o
       set client_request_id=_client_request_id,
           kiosk_device_id=d.id,
           table_id=case when table_token is null then null else t.id end,
           table_session_id=case when table_token is null then null else sess.id end,
           table_label=case when table_token is null then '' else t.label end,
           updated_at=now()
     where o.id=created.id
       and o.organization_id=d.organization_id
    returning o.* into existing_order;

    if not found
       or existing_order.user_id is not null
       or lower(coalesce(existing_order.payment_method,''))<>'cash'
       or coalesce(existing_order.payment_status,'pending')<>'pending'
       or abs(coalesce(existing_order.total,0)-current_total)>0.01 then
      raise exception 'authoritative_order_postcondition_failed';
    end if;

    update private.kiosk_order_syncs s
       set state='synced',
           order_id=existing_order.id,
           conflict_reason=null,
           synced_at=now(),
           last_attempt_at=now(),
           updated_at=now()
     where s.id=sync_row.id;

    update private.kiosk_devices
       set last_seen_at=now(),updated_at=now()
     where id=d.id;

    return jsonb_build_object(
      'ok',true,
      'state','synced',
      'idempotent',false,
      'device_id',d.id,
      'client_request_id',_client_request_id,
      'order_id',existing_order.id,
      'order_number',existing_order.order_number,
      'delivery_code',coalesce(existing_order.delivery_code,''),
      'total',existing_order.total,
      'payment_method',existing_order.payment_method,
      'payment_status',coalesce(existing_order.payment_status,'pending'),
      'table_label',coalesce(existing_order.table_label,''),
      'table_session_id',existing_order.table_session_id,
      'reconciliation',jsonb_build_object(
        'subtotal',current_subtotal,
        'coupon_discount',current_coupon_discount,
        'prime_discount',0,
        'delivery_fee',current_delivery_fee,
        'total',current_total,
        'vision_prime_applied',false
      )
    );
  exception
    when others then
      get stacked diagnostics
        conflict_message=message_text,
        sql_state=returned_sqlstate;

      -- Rate limiting and unexpected infrastructure/database failures remain
      -- retryable. Re-raising rolls back the sync reservation and all work.
      if conflict_message ilike '%rate_limited%'
         or sql_state not in ('P0001','22P02','22003','22007','22008') then
        raise;
      end if;

      conflict_code:=case
        when conflict_message ilike '%commercial_terms_changed%' then 'commercial_terms_changed'
        when conflict_message ilike '%customer_benefit_requires_authentication%' then 'customer_benefit_requires_authentication'
        when conflict_message ilike '%scheduled%' then 'scheduled_order_requires_review'
        when conflict_message ilike '%table%' then 'table_conflict'
        when conflict_message ilike '%coupon%' then 'coupon_conflict'
        when conflict_message ilike '%ingredient%' then 'ingredient_conflict'
        when conflict_message ilike '%stock%' then 'stock_conflict'
        when conflict_message ilike '%product%' then 'product_conflict'
        when conflict_message ilike '%delivery%'
          or conflict_message ilike '%bairro%'
          or conflict_message ilike '%cep%' then 'delivery_conflict'
        when conflict_message ilike '%payment%' then 'payment_conflict'
        when conflict_message ilike '%quantity%'
          or conflict_message ilike '%weight%'
          or conflict_message ilike '%extra%'
          or conflict_message ilike '%item%' then 'item_conflict'
        when conflict_message ilike '%organization%' then 'organization_unavailable'
        when conflict_message ilike '%snapshot%' then 'offline_snapshot_invalid'
        else 'invalid_offline_order'
      end;

      update private.kiosk_order_syncs s
         set state='needs_attention',
             conflict_reason=conflict_code,
             last_attempt_at=now(),
             updated_at=now()
       where s.id=sync_row.id;

      return jsonb_build_object(
        'ok',false,
        'state','needs_attention',
        'reason',conflict_code,
        'device_id',d.id,
        'client_request_id',_client_request_id
      );
  end;
end
$function$;

revoke all on function public.visionfood_sync_kiosk_order(uuid,text,uuid,uuid,jsonb)
from public, anon, authenticated;
grant execute on function public.visionfood_sync_kiosk_order(uuid,text,uuid,uuid,jsonb)
to anon, service_role;
