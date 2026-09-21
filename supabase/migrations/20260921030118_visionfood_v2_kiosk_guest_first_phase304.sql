-- PHASE 304 follow-up: guest-first checkout for enrolled physical kiosks.
-- Customer login is never required for the device-owned path.
-- Optional customer identity stays optional; blank phone is not synthesized.
-- Web/authenticated checkout contracts remain unchanged.

CREATE OR REPLACE FUNCTION public.visionfood_sync_kiosk_order(_device_id uuid, _credential text, _client_request_id uuid, _local_order_id uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  org_rate private.checkout_rate_limits%rowtype;
  device_rate private.checkout_rate_limits%rowtype;
  org_rate_key text;
  device_rate_key text;
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
    'customer_name',case
      when char_length(btrim(coalesce(_payload->>'customer_name',''))) between 2 and 120
        then btrim(_payload->>'customer_name')
      else 'Cliente Totem'
    end,
    'customer_phone',case
      when char_length(regexp_replace(coalesce(_payload->>'customer_phone',''),'[^0-9]','','g')) between 8 and 30
        then regexp_replace(_payload->>'customer_phone','[^0-9]','','g')
      else ''
    end,
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
        and (rt.public_token=table_token or rt.id=table_token)
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

    -- Device-owned guest checkout never invents customer identity. A valid
    -- optional phone is preserved; otherwise customer_phone remains empty.
    -- Abuse control is independent from customer phone and is scoped to the
    -- enrolled device + organization.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('visionfood:kiosk-rate:'||d.organization_id::text,0)
    );

    org_rate_key:='kiosk-org:'||d.organization_id::text;
    device_rate_key:='kiosk-device:'||d.id::text;

    select * into org_rate
    from private.checkout_rate_limits
    where scope_key=org_rate_key
    for update;

    if found and org_rate.window_started_at<=now()-interval '1 minute' then
      update private.checkout_rate_limits
         set window_started_at=now(),successful_count=0,updated_at=now()
       where scope_key=org_rate_key
      returning * into org_rate;
    end if;

    if found and org_rate.successful_count>=120 then
      raise exception 'kiosk_checkout_rate_limited';
    end if;

    select * into device_rate
    from private.checkout_rate_limits
    where scope_key=device_rate_key
    for update;

    if found and device_rate.window_started_at<=now()-interval '1 minute' then
      update private.checkout_rate_limits
         set window_started_at=now(),successful_count=0,updated_at=now()
       where scope_key=device_rate_key
      returning * into device_rate;
    end if;

    if found and device_rate.successful_count>=30 then
      raise exception 'kiosk_device_rate_limited';
    end if;

    select *
      into created
    from public.create_order_checkout_v2(
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

    insert into private.checkout_rate_limits(scope_key,window_started_at,successful_count,updated_at)
    values(org_rate_key,now(),1,now())
    on conflict(scope_key) do update
      set successful_count=private.checkout_rate_limits.successful_count+1,
          updated_at=now();

    insert into private.checkout_rate_limits(scope_key,window_started_at,successful_count,updated_at)
    values(device_rate_key,now(),1,now())
    on conflict(scope_key) do update
      set successful_count=private.checkout_rate_limits.successful_count+1,
          updated_at=now();

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
$function$

