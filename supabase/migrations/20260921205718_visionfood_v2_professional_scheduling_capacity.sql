-- Professional scheduling capacity + operational release gates.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS scheduling_slot_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS scheduling_capacity_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduling_max_orders_per_slot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduling_preparation_lead_min integer NOT NULL DEFAULT 30;

CREATE INDEX IF NOT EXISTS orders_scheduled_for_org_idx
  ON public.orders (organization_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL AND status <> 'cancelled';

CREATE OR REPLACE FUNCTION private.visionfood_schedule_release_at(
  _organization_id uuid,
  _scheduled_for timestamptz
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select case
    when _scheduled_for is null then null
    else _scheduled_for - make_interval(
      mins => greatest(
        0,
        least(
          coalesce((
            select s.scheduling_preparation_lead_min
            from public.settings s
            where s.organization_id=_organization_id
            limit 1
          ),30),
          360
        )
      )
    )
  end
$function$;

REVOKE ALL ON FUNCTION private.visionfood_schedule_release_at(uuid,timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.visionfood_schedule_availability(
  _organization_id uuid,
  _scheduled_for timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  s public.settings%rowtype;
  v_local timestamp;
  v_date date;
  v_prev_date date;
  v_minute integer;
  v_day text;
  v_prev_day text;
  v_cfg jsonb;
  v_prev_cfg jsonb;
  v_window jsonb;
  v_start integer;
  v_end integer;
  v_open boolean:=false;
  v_slot integer:=30;
  v_max integer:=0;
  v_capacity boolean:=false;
  v_slot_start_local timestamp;
  v_slot_end_local timestamp;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_count integer:=0;
  v_release_at timestamptz;
begin
  if _organization_id is null or _scheduled_for is null then
    return jsonb_build_object('ok',false,'reason','schedule_invalid');
  end if;

  select * into s
  from public.settings
  where organization_id=_organization_id
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'reason','schedule_settings_missing');
  end if;

  if coalesce(s.scheduling_enabled,true) is not true then
    return jsonb_build_object('ok',false,'reason','scheduling_disabled');
  end if;

  if _scheduled_for <= now() then
    return jsonb_build_object('ok',false,'reason','schedule_must_be_future');
  end if;

  v_local:=_scheduled_for at time zone 'America/Sao_Paulo';
  v_date:=v_local::date;
  v_minute:=extract(hour from v_local)::int*60 + extract(minute from v_local)::int;
  v_slot:=case when coalesce(s.scheduling_slot_minutes,30)=15 then 15 else 30 end;
  v_max:=greatest(coalesce(s.scheduling_max_orders_per_slot,0),0);
  v_capacity:=coalesce(s.scheduling_capacity_enabled,false) and v_max>0;

  if mod(v_minute,v_slot)<>0 then
    return jsonb_build_object(
      'ok',false,
      'reason','schedule_slot_alignment',
      'slot_minutes',v_slot
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(s.special_closures,'[]'::jsonb)) c
    where c->>'date'=to_char(v_date,'YYYY-MM-DD')
  ) then
    return jsonb_build_object('ok',false,'reason','store_closed_special_date');
  end if;

  v_day:=case extract(dow from v_local)::int
    when 0 then 'sun' when 1 then 'mon' when 2 then 'tue'
    when 3 then 'wed' when 4 then 'thu' when 5 then 'fri'
    else 'sat' end;
  v_cfg:=coalesce(s.business_hours,'{}'::jsonb)->v_day;

  if coalesce((v_cfg->>'enabled')::boolean,false) then
    for v_window in
      select value from jsonb_array_elements(coalesce(v_cfg->'windows','[]'::jsonb))
    loop
      v_start:=split_part(v_window->>0,':',1)::int*60 + split_part(v_window->>0,':',2)::int;
      v_end:=split_part(v_window->>1,':',1)::int*60 + split_part(v_window->>1,':',2)::int;
      if v_start<>v_end and (
        (v_end>v_start and v_minute>=v_start and v_minute<v_end)
        or (v_end<v_start and v_minute>=v_start)
      ) then
        v_open:=true;
        exit;
      end if;
    end loop;
  end if;

  if not v_open then
    v_prev_date:=v_date-1;
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(s.special_closures,'[]'::jsonb)) c
      where c->>'date'=to_char(v_prev_date,'YYYY-MM-DD')
    ) then
      v_prev_day:=case extract(dow from v_prev_date)::int
        when 0 then 'sun' when 1 then 'mon' when 2 then 'tue'
        when 3 then 'wed' when 4 then 'thu' when 5 then 'fri'
        else 'sat' end;
      v_prev_cfg:=coalesce(s.business_hours,'{}'::jsonb)->v_prev_day;
      if coalesce((v_prev_cfg->>'enabled')::boolean,false) then
        for v_window in
          select value from jsonb_array_elements(coalesce(v_prev_cfg->'windows','[]'::jsonb))
        loop
          v_start:=split_part(v_window->>0,':',1)::int*60 + split_part(v_window->>0,':',2)::int;
          v_end:=split_part(v_window->>1,':',1)::int*60 + split_part(v_window->>1,':',2)::int;
          if v_end<v_start and v_minute<v_end then
            v_open:=true;
            exit;
          end if;
        end loop;
      end if;
    end if;
  end if;

  if not v_open then
    return jsonb_build_object('ok',false,'reason','schedule_outside_business_hours');
  end if;

  v_slot_start_local:=date_trunc('day',v_local)
    + make_interval(mins => floor(v_minute::numeric/v_slot)::int*v_slot);
  v_slot_end_local:=v_slot_start_local + make_interval(mins => v_slot);
  v_slot_start:=v_slot_start_local at time zone 'America/Sao_Paulo';
  v_slot_end:=v_slot_end_local at time zone 'America/Sao_Paulo';

  if v_capacity then
    select count(*)::int into v_count
    from public.orders o
    where o.organization_id=_organization_id
      and o.scheduled_for>=v_slot_start
      and o.scheduled_for<v_slot_end
      and o.status<>'cancelled';

    if v_count>=v_max then
      return jsonb_build_object(
        'ok',false,
        'reason','schedule_slot_full',
        'slot_minutes',v_slot,
        'slot_start',v_slot_start,
        'slot_end',v_slot_end,
        'count',v_count,
        'max_orders',v_max,
        'remaining',0
      );
    end if;
  end if;

  v_release_at:=private.visionfood_schedule_release_at(_organization_id,_scheduled_for);

  return jsonb_build_object(
    'ok',true,
    'slot_minutes',v_slot,
    'slot_start',v_slot_start,
    'slot_end',v_slot_end,
    'capacity_enabled',v_capacity,
    'count',v_count,
    'max_orders',v_max,
    'remaining',case when v_capacity then greatest(v_max-v_count,0) else null end,
    'release_at',v_release_at
  );
end
$function$;

GRANT EXECUTE ON FUNCTION public.visionfood_schedule_availability(uuid,timestamptz) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.visionfood_public_storefront_config(_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if _org is null then
    raise exception 'invalid_organization';
  end if;

  if coalesce(
    (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
    true
  ) then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'organization_id',o.id,
    'store_name',coalesce(nullif(s.store_name,''),nullif(s.nome_loja,''),nullif(o.name,''),'VisionFood'),
    'whatsapp_number',coalesce(nullif(s.whatsapp_number,''),nullif(s.telefone,''),nullif(s.phone,''),nullif(o.whatsapp,''),nullif(o.telefone,''),''),
    'share_image',coalesce(nullif(s.cover_image,''),nullif(s.imagem_capa,''),nullif(s.logo_url,''),nullif(o.logo_url,''),''),
    'combo',coalesce(s.combo,'{}'::jsonb),
    'banners',coalesce(s.banners,'[]'::jsonb),
    'instagram_url',coalesce(nullif(s.instagram_url,''),nullif(o.instagram,''),''),
    'categories',coalesce(s.categories,'[]'::jsonb),
    'category_icons',coalesce(s.category_icons,'{}'::jsonb),
    'delivery_enabled',coalesce(s.delivery_enabled,true),
    'business_hours',s.business_hours,
    'special_closures',coalesce(s.special_closures,'[]'::jsonb),
    'emergency_closed',coalesce(s.emergency_closed,false),
    'closed_message',coalesce(nullif(s.closed_message,''),'Lanchonete fechada no momento'),
    'scheduling_enabled',coalesce(s.scheduling_enabled,true),
    'scheduling_slot_minutes',case when coalesce(s.scheduling_slot_minutes,30)=15 then 15 else 30 end,
    'scheduling_capacity_enabled',coalesce(s.scheduling_capacity_enabled,false),
    'scheduling_max_orders_per_slot',greatest(coalesce(s.scheduling_max_orders_per_slot,0),0),
    'scheduling_preparation_lead_min',greatest(0,least(coalesce(s.scheduling_preparation_lead_min,30),360)),
    'balanca_baud_rate',case
      when s.balanca_baud_rate in (4800,9600) then s.balanca_baud_rate
      else 9600
    end,
    'delivery_tempo_base_min',coalesce(s.delivery_tempo_base_min,s.delivery_tempo_estimado,30),
    'delivery_mode',coalesce(s.delivery_mode,'bairros'),
    'updated_at',s.updated_at
  )
  into v_result
  from public.organizations o
  left join public.settings s on s.organization_id=o.id
  where o.id=_org
  limit 1;

  return coalesce(v_result,'{}'::jsonb);
end
$function$;

CREATE OR REPLACE FUNCTION public.create_order_checkout_v3(
  _organization_id uuid,
  _customer_name text,
  _customer_phone text DEFAULT ''::text,
  _customer_cpf text DEFAULT ''::text,
  _order_type text DEFAULT 'local'::text,
  _delivery_address text DEFAULT ''::text,
  _delivery_reference text DEFAULT ''::text,
  _delivery_recipient text DEFAULT ''::text,
  _bairro_id uuid DEFAULT NULL::uuid,
  _bairro_nome text DEFAULT ''::text,
  _delivery_fee numeric DEFAULT 0,
  _items jsonb DEFAULT '[]'::jsonb,
  _total numeric DEFAULT 0,
  _payment_method text DEFAULT ''::text,
  _scheduled_for timestamptz DEFAULT NULL::timestamptz,
  _coupon_code text DEFAULT ''::text,
  _delivery_context jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(id uuid, order_number text, delivery_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_number text;
  v_code text;
  v_phone text;
  v_org_key text;
  v_phone_key text;
  v_org_limit private.checkout_rate_limits%rowtype;
  v_phone_limit private.checkout_rate_limits%rowtype;
  v_schedule jsonb;
begin
  if _organization_id is null then
    raise exception 'invalid_organization';
  end if;

  if length(btrim(coalesce(_customer_name,'')))<2 then
    raise exception 'invalid_customer_name';
  end if;

  v_phone:=regexp_replace(coalesce(_customer_phone,''),'[^0-9]','','g');
  if length(v_phone)<8 then
    raise exception 'invalid_customer_phone';
  end if;

  if _order_type in ('delivery','viagem') then
    if length(btrim(coalesce(_delivery_address,'')))<5 then
      raise exception 'invalid_delivery_address';
    end if;
    if length(btrim(coalesce(_delivery_recipient,'')))<2 then
      raise exception 'invalid_delivery_recipient';
    end if;
  end if;

  perform public.quote_order_checkout_v2(
    _organization_id,_order_type,_bairro_id,_delivery_fee,_items,_coupon_code,_delivery_context
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('visionfood:checkout:'||_organization_id::text,0)
  );

  if _scheduled_for is not null then
    v_schedule:=public.visionfood_schedule_availability(_organization_id,_scheduled_for);
    if coalesce((v_schedule->>'ok')::boolean,false) is not true then
      raise exception '%',coalesce(v_schedule->>'reason','schedule_unavailable');
    end if;
  end if;

  v_org_key:='org:'||_organization_id::text;

  select * into v_org_limit
  from private.checkout_rate_limits
  where scope_key=v_org_key
  for update;

  if found and v_org_limit.window_started_at<=now()-interval '1 minute' then
    update private.checkout_rate_limits
       set window_started_at=now(),successful_count=0,updated_at=now()
     where scope_key=v_org_key
    returning * into v_org_limit;
  end if;

  if found and v_org_limit.successful_count>=120 then
    raise exception 'checkout_rate_limited';
  end if;

  v_phone_key:='phone:'||encode(
    extensions.digest(_organization_id::text||E'\\n'||v_phone,'sha256'),
    'hex'
  );

  select * into v_phone_limit
  from private.checkout_rate_limits
  where scope_key=v_phone_key
  for update;

  if found and v_phone_limit.window_started_at<=now()-interval '2 minutes' then
    update private.checkout_rate_limits
       set window_started_at=now(),successful_count=0,updated_at=now()
     where scope_key=v_phone_key
    returning * into v_phone_limit;
  end if;

  if found and v_phone_limit.successful_count>=5 then
    raise exception 'checkout_phone_rate_limited';
  end if;

  select x.id,x.order_number
    into v_id,v_number
  from public.create_order_checkout_v2(
    _organization_id,btrim(_customer_name),v_phone,_customer_cpf,_order_type,
    btrim(coalesce(_delivery_address,'')),
    btrim(coalesce(_delivery_reference,'')),
    btrim(coalesce(_delivery_recipient,'')),
    _bairro_id,btrim(coalesce(_bairro_nome,'')),
    _delivery_fee,_items,_total,_payment_method,_scheduled_for,_coupon_code,_delivery_context
  ) x;

  insert into private.checkout_rate_limits(
    scope_key,window_started_at,successful_count,updated_at
  )
  values(v_org_key,now(),1,now())
  on conflict(scope_key) do update
    set successful_count=private.checkout_rate_limits.successful_count+1,
        updated_at=now();

  insert into private.checkout_rate_limits(
    scope_key,window_started_at,successful_count,updated_at
  )
  values(v_phone_key,now(),1,now())
  on conflict(scope_key) do update
    set successful_count=private.checkout_rate_limits.successful_count+1,
        updated_at=now();

  delete from private.checkout_rate_limits
  where updated_at<now()-interval '1 day';

  select coalesce(o.delivery_code,'')
    into v_code
  from public.orders o
  where o.id=v_id;

  return query
  select v_id,v_number,
         case when _order_type in ('delivery','viagem') then v_code else '' end;
end
$function$;

CREATE OR REPLACE FUNCTION public.visionfood_update_order_status(
  _order_id uuid,
  _expected_status text,
  _next_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  u uuid:=auth.uid();
  o public.orders%rowtype;
  v_allowed boolean:=false;
  v_release_at timestamptz;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  select * into o
  from public.orders
  where id=_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','not_found');
  end if;

  if not private.usuario_dono_org(o.organization_id,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if _expected_status is null or o.status is distinct from _expected_status then
    return jsonb_build_object('ok',false,'reason','status_changed','current_status',o.status);
  end if;

  if _next_status is null or _next_status=_expected_status then
    return jsonb_build_object('ok',false,'reason','invalid_transition');
  end if;

  v_release_at:=private.visionfood_schedule_release_at(o.organization_id,o.scheduled_for);
  if v_release_at is not null
     and now()<v_release_at
     and _next_status in ('preparing','out_for_delivery') then
    return jsonb_build_object(
      'ok',false,
      'reason','scheduled_not_released',
      'scheduled_for',o.scheduled_for,
      'release_at',v_release_at
    );
  end if;

  if o.status='ready'
     and o.order_type in ('delivery','viagem')
     and _next_status='out_for_delivery'
     and o.entregador_id is null then
    return jsonb_build_object('ok',false,'reason','driver_required');
  end if;

  v_allowed:=case
    when o.status='pending' then _next_status='preparing'
    when o.status='preparing' then _next_status='ready'
    when o.status='ready' and o.order_type in ('delivery','viagem')
      then _next_status='out_for_delivery'
    when o.status='ready' and o.order_type not in ('delivery','viagem')
      then _next_status='delivered'
    when o.status='out_for_delivery' and o.order_type in ('delivery','viagem')
      then _next_status='delivered'
    else false
  end;

  if not v_allowed then
    return jsonb_build_object(
      'ok',false,'reason','invalid_transition',
      'current_status',o.status,'requested_status',_next_status
    );
  end if;

  update public.orders
     set status=_next_status,updated_at=now()
   where id=o.id;

  return jsonb_build_object(
    'ok',true,'order_id',o.id,'previous_status',o.status,'status',_next_status
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.visionfood_dispatch_orders(
  _order_ids uuid[],
  _entregador_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  u uuid:=auth.uid();
  e public.entregadores%rowtype;
  o public.orders%rowtype;
  v_expected int;
  v_seen int:=0;
  v_distinct int;
  v_release_at timestamptz;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  v_expected:=coalesce(cardinality(_order_ids),0);
  if v_expected<1 or v_expected>200 then
    return jsonb_build_object('ok',false,'reason','invalid_order_count');
  end if;

  select count(distinct x)::int into v_distinct
  from unnest(_order_ids) as t(x);

  if v_distinct<>v_expected then
    return jsonb_build_object('ok',false,'reason','duplicate_order_id');
  end if;

  select * into e
  from public.entregadores
  where id=_entregador_id
    and coalesce(active,true)=true
    and coalesce(ativo,true)=true;

  if not found then
    return jsonb_build_object('ok',false,'reason','entregador_invalid');
  end if;

  if not private.usuario_dono_org(e.organization_id,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  for o in
    select *
    from public.orders
    where id=any(_order_ids)
    order by id
    for update
  loop
    v_seen:=v_seen+1;

    if o.organization_id is distinct from e.organization_id then
      return jsonb_build_object('ok',false,'reason','cross_organization_order','order_id',o.id);
    end if;

    if o.order_type not in ('delivery','viagem') then
      return jsonb_build_object('ok',false,'reason','not_delivery_order','order_id',o.id);
    end if;

    if o.status<>'ready' then
      return jsonb_build_object(
        'ok',false,'reason','status_changed','order_id',o.id,'current_status',o.status
      );
    end if;

    v_release_at:=private.visionfood_schedule_release_at(o.organization_id,o.scheduled_for);
    if v_release_at is not null and now()<v_release_at then
      return jsonb_build_object(
        'ok',false,'reason','scheduled_not_released',
        'order_id',o.id,'scheduled_for',o.scheduled_for,'release_at',v_release_at
      );
    end if;

    if o.entregador_id is not null and o.entregador_id is distinct from _entregador_id then
      return jsonb_build_object(
        'ok',false,'reason','already_assigned','order_id',o.id,'entregador_id',o.entregador_id
      );
    end if;
  end loop;

  if v_seen<>v_expected then
    return jsonb_build_object('ok',false,'reason','order_not_found');
  end if;

  update public.orders
     set entregador_id=_entregador_id,status='out_for_delivery',updated_at=now()
   where id=any(_order_ids);

  return jsonb_build_object('ok',true,'count',v_expected,'entregador_id',_entregador_id);
end
$function$;

CREATE OR REPLACE FUNCTION public.entregador_available_orders_session(_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_e public.entregadores%rowtype;
  v_mode text;
  v_rows jsonb;
begin
  v_e:=public.entregador_session_driver(_session_token);
  if v_e.id is null then
    return jsonb_build_object('ok',false,'reason','invalid_session');
  end if;

  select coalesce(delivery_assignment_mode,'manual')
    into v_mode
  from public.settings
  where organization_id=v_e.organization_id
  limit 1;

  if v_mode<>'free' then
    return jsonb_build_object('ok',true,'mode',coalesce(v_mode,'manual'),'orders','[]'::jsonb);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'bairro_nome',o.bairro_nome,
        'total',o.total,
        'status',o.status,
        'order_type',o.order_type,
        'scheduled_for',o.scheduled_for,
        'created_at',o.created_at
      )
      order by coalesce(o.scheduled_for,o.created_at) asc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.orders o
  where o.organization_id=v_e.organization_id
    and o.order_type in ('delivery','viagem')
    and o.entregador_id is null
    and o.status='ready'
    and (
      o.scheduled_for is null
      or now()>=private.visionfood_schedule_release_at(o.organization_id,o.scheduled_for)
    )
    and (
      (o.scheduled_for is null and o.created_at>now()-interval '1 day')
      or (o.scheduled_for is not null and o.scheduled_for>now()-interval '1 day')
    );

  return jsonb_build_object('ok',true,'mode',v_mode,'orders',v_rows);
end
$function$;

CREATE OR REPLACE FUNCTION public.entregador_orders_session(_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_e public.entregadores%rowtype;
  v_rows jsonb;
begin
  v_e:=public.entregador_session_driver(_session_token);
  if v_e.id is null then
    return jsonb_build_object('ok',false,'reason','invalid_session');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'customer_name',o.customer_name,
        'customer_phone',o.customer_phone,
        'delivery_address',o.delivery_address,
        'delivery_reference',o.delivery_reference,
        'delivery_recipient',o.delivery_recipient,
        'bairro_nome',o.bairro_nome,
        'items',coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name',i->>'name',
              'quantity',coalesce(i->'quantity','1'::jsonb)
            )
          )
          from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) i
        ),'[]'::jsonb),
        'total',o.total,
        'status',o.status,
        'order_type',o.order_type,
        'scheduled_for',o.scheduled_for,
        'created_at',o.created_at
      )
      order by coalesce(o.scheduled_for,o.created_at) desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.orders o
  where o.organization_id=v_e.organization_id
    and o.entregador_id=v_e.id
    and o.status in ('preparing','out_for_delivery','ready','delivered')
    and (
      o.status='delivered'
      or o.scheduled_for is null
      or now()>=private.visionfood_schedule_release_at(o.organization_id,o.scheduled_for)
    )
    and (
      o.created_at>now()-interval '7 days'
      or o.scheduled_for>now()-interval '7 days'
    );

  return jsonb_build_object('ok',true,'orders',v_rows);
end
$function$;

CREATE OR REPLACE FUNCTION public.entregador_claim_order_session(
  _session_token text,
  _order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_e public.entregadores%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_mode text;
  v_updated int;
  v_release_at timestamptz;
BEGIN
  v_e := public.entregador_session_driver(_session_token);
  IF v_e.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id=_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','order_not_found'); END IF;
  IF v_order.organization_id<>v_e.organization_id THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
  IF v_order.order_type NOT IN ('delivery','viagem') THEN RETURN jsonb_build_object('ok',false,'reason','not_delivery'); END IF;
  IF v_order.status<>'ready' THEN RETURN jsonb_build_object('ok',false,'reason','not_ready'); END IF;

  v_release_at:=private.visionfood_schedule_release_at(v_order.organization_id,v_order.scheduled_for);
  IF v_release_at IS NOT NULL AND now()<v_release_at THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','scheduled_not_released',
      'scheduled_for',v_order.scheduled_for,'release_at',v_release_at
    );
  END IF;

  SELECT COALESCE(delivery_assignment_mode,'manual')
    INTO v_mode FROM public.settings
    WHERE organization_id=v_e.organization_id
    LIMIT 1;

  IF v_mode<>'free' THEN RETURN jsonb_build_object('ok',false,'reason','mode_not_free'); END IF;
  IF v_order.entregador_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason','already_taken'); END IF;

  UPDATE public.orders
  SET entregador_id=v_e.id, status='out_for_delivery', updated_at=now()
  WHERE id=_order_id
    AND organization_id=v_e.organization_id
    AND order_type IN ('delivery','viagem')
    AND status='ready'
    AND entregador_id IS NULL;

  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated=0 THEN RETURN jsonb_build_object('ok',false,'reason','order_changed'); END IF;
  RETURN jsonb_build_object('ok',true,'status','out_for_delivery');
END
$function$;
