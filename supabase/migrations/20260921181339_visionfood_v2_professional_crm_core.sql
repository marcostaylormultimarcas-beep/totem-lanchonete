
create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid,
  phone_normalized text not null,
  name text not null default '',
  email text not null default '',
  birth_date date,
  tags text[] not null default '{}'::text[],
  notes text not null default '',
  consent_status text not null default 'unknown'
    check (consent_status in ('unknown','opt_in','opt_out')),
  consent_source text not null default '',
  consent_at timestamptz,
  source text not null default 'orders',
  lifecycle_stage text not null default 'lead'
    check (lifecycle_stage in ('lead','customer','vip')),
  first_seen_at timestamptz not null default now(),
  last_activity_at timestamptz,
  confirmed_orders integer not null default 0 check (confirmed_orders >= 0),
  confirmed_revenue numeric not null default 0 check (confirmed_revenue >= 0),
  average_ticket numeric not null default 0 check (average_ticket >= 0),
  first_purchase_at timestamptz,
  last_purchase_at timestamptz,
  last_order_total numeric not null default 0 check (last_order_total >= 0),
  favorite_product text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone_normalized)
);

create table if not exists public.crm_interactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  campaign_id uuid,
  channel text not null default 'whatsapp'
    check (channel in ('whatsapp','phone','email','other')),
  objective text not null default 'recuperar',
  message text not null default '',
  status text not null default 'opened'
    check (status in ('draft','opened','sent','failed','converted','dismissed')),
  opened_at timestamptz,
  sent_at timestamptz,
  converted_at timestamptz,
  converted_order_id uuid references public.orders(id) on delete set null,
  attributed_revenue numeric not null default 0 check (attributed_revenue >= 0),
  created_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  objective text not null default 'recuperar',
  status text not null default 'draft'
    check (status in ('draft','active','paused','completed')),
  segment jsonb not null default '{}'::jsonb,
  message_template text not null default '',
  total_contacts integer not null default 0 check (total_contacts >= 0),
  opened_count integer not null default 0 check (opened_count >= 0),
  converted_count integer not null default 0 check (converted_count >= 0),
  attributed_revenue numeric not null default 0 check (attributed_revenue >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_interactions
  drop constraint if exists crm_interactions_campaign_id_fkey;
alter table public.crm_interactions
  add constraint crm_interactions_campaign_id_fkey
  foreign key (campaign_id) references public.crm_campaigns(id) on delete set null;

create table if not exists public.crm_automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  trigger_type text not null default 'inactive'
    check (trigger_type in ('inactive','birthday','post_purchase')),
  days_threshold integer,
  objective text not null default 'recuperar',
  message_context text not null default '',
  active boolean not null default true,
  auto_send boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, trigger_type, days_threshold)
);

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  automation_id uuid references public.crm_automations(id) on delete cascade,
  due_date date not null,
  objective text not null default 'recuperar',
  status text not null default 'pending'
    check (status in ('pending','opened','done','dismissed')),
  generated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (contact_id, automation_id, due_date)
);

create index if not exists crm_contacts_org_last_purchase_idx
  on public.crm_contacts (organization_id, last_purchase_at desc);
create index if not exists crm_contacts_org_stage_idx
  on public.crm_contacts (organization_id, lifecycle_stage);
create index if not exists crm_contacts_org_consent_idx
  on public.crm_contacts (organization_id, consent_status);
create index if not exists crm_interactions_org_created_idx
  on public.crm_interactions (organization_id, created_at desc);
create index if not exists crm_interactions_contact_created_idx
  on public.crm_interactions (contact_id, created_at desc);
create index if not exists crm_interactions_conversion_idx
  on public.crm_interactions (organization_id, converted_at desc)
  where converted_at is not null;
create index if not exists crm_campaigns_org_status_idx
  on public.crm_campaigns (organization_id, status, created_at desc);
create index if not exists crm_automations_org_active_idx
  on public.crm_automations (organization_id, active);
create index if not exists crm_tasks_org_status_due_idx
  on public.crm_tasks (organization_id, status, due_date);

alter table public.crm_contacts enable row level security;
alter table public.crm_interactions enable row level security;
alter table public.crm_campaigns enable row level security;
alter table public.crm_automations enable row level security;
alter table public.crm_tasks enable row level security;

create or replace function public.crm_can_manage(_org uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select
    auth.uid() is not null
    and _org is not null
    and (
      private.usuario_dono_org(_org, auth.uid())
      or exists (
        select 1
        from public.organizations o
        where o.id = _org
          and o.master_id = auth.uid()
      )
      or private.eh_super_admin(auth.uid())
    );
$function$;

revoke all on function public.crm_can_manage(uuid) from public, anon;
grant execute on function public.crm_can_manage(uuid) to authenticated;

drop policy if exists "crm contacts manager select" on public.crm_contacts;
drop policy if exists "crm contacts manager update" on public.crm_contacts;
create policy "crm contacts manager select"
  on public.crm_contacts for select to authenticated
  using (public.crm_can_manage(organization_id));
create policy "crm contacts manager update"
  on public.crm_contacts for update to authenticated
  using (public.crm_can_manage(organization_id))
  with check (public.crm_can_manage(organization_id));

drop policy if exists "crm interactions manager all" on public.crm_interactions;
create policy "crm interactions manager all"
  on public.crm_interactions for all to authenticated
  using (public.crm_can_manage(organization_id))
  with check (public.crm_can_manage(organization_id));

drop policy if exists "crm campaigns manager all" on public.crm_campaigns;
create policy "crm campaigns manager all"
  on public.crm_campaigns for all to authenticated
  using (public.crm_can_manage(organization_id))
  with check (public.crm_can_manage(organization_id));

drop policy if exists "crm automations manager all" on public.crm_automations;
create policy "crm automations manager all"
  on public.crm_automations for all to authenticated
  using (public.crm_can_manage(organization_id))
  with check (public.crm_can_manage(organization_id));

drop policy if exists "crm tasks manager all" on public.crm_tasks;
create policy "crm tasks manager all"
  on public.crm_tasks for all to authenticated
  using (public.crm_can_manage(organization_id))
  with check (public.crm_can_manage(organization_id));

revoke all on public.crm_contacts from anon;
revoke all on public.crm_interactions from anon;
revoke all on public.crm_campaigns from anon;
revoke all on public.crm_automations from anon;
revoke all on public.crm_tasks from anon;

grant select, update on public.crm_contacts to authenticated;
grant select, insert, update, delete on public.crm_interactions to authenticated;
grant select, insert, update, delete on public.crm_campaigns to authenticated;
grant select, insert, update, delete on public.crm_automations to authenticated;
grant select, insert, update, delete on public.crm_tasks to authenticated;

create or replace function private.crm_recalculate_contact(_org uuid, _phone text)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_phone text := regexp_replace(coalesce(_phone,''),'[^0-9]','','g');
  v_name text := '';
  v_user_id uuid;
  v_first_seen timestamptz;
  v_last_activity timestamptz;
  v_orders integer := 0;
  v_revenue numeric := 0;
  v_first_purchase timestamptz;
  v_last_purchase timestamptz;
  v_last_total numeric := 0;
  v_favorite text := '';
  v_stage text := 'lead';
begin
  if _org is null or length(v_phone) < 8 then
    return;
  end if;

  select
    coalesce((
      select nullif(btrim(o.customer_name),'')
      from public.orders o
      where o.organization_id=_org
        and regexp_replace(coalesce(o.customer_phone,''),'[^0-9]','','g')=v_phone
        and coalesce(o.status,'') <> 'cancelled'
      order by o.created_at desc
      limit 1
    ),'Cliente'),
    (
      select o.user_id
      from public.orders o
      where o.organization_id=_org
        and regexp_replace(coalesce(o.customer_phone,''),'[^0-9]','','g')=v_phone
        and o.user_id is not null
      order by o.created_at desc
      limit 1
    ),
    min(o.created_at) filter (where coalesce(o.status,'') <> 'cancelled'),
    max(o.created_at) filter (where coalesce(o.status,'') <> 'cancelled')
  into v_name,v_user_id,v_first_seen,v_last_activity
  from public.orders o
  where o.organization_id=_org
    and regexp_replace(coalesce(o.customer_phone,''),'[^0-9]','','g')=v_phone;

  if v_last_activity is null then
    delete from public.crm_contacts
    where organization_id=_org and phone_normalized=v_phone;
    return;
  end if;

  select
    count(*)::int,
    coalesce(sum(greatest(coalesce(o.total,0),0)),0),
    min(o.created_at),
    max(o.created_at)
  into v_orders,v_revenue,v_first_purchase,v_last_purchase
  from public.orders o
  where o.organization_id=_org
    and regexp_replace(coalesce(o.customer_phone,''),'[^0-9]','','g')=v_phone
    and o.status='delivered'
    and o.payment_status='paid';

  select greatest(coalesce(o.total,0),0)
  into v_last_total
  from public.orders o
  where o.organization_id=_org
    and regexp_replace(coalesce(o.customer_phone,''),'[^0-9]','','g')=v_phone
    and o.status='delivered'
    and o.payment_status='paid'
  order by o.created_at desc
  limit 1;
  v_last_total := coalesce(v_last_total,0);

  select coalesce(x.product_name,'')
  into v_favorite
  from (
    select
      coalesce(nullif(btrim(item->>'name'),''),nullif(btrim(item->>'product_name'),'')) as product_name,
      sum(greatest(coalesce(nullif(item->>'quantity','')::numeric,1),0)) as qty
    from public.orders o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end
    ) item
    where o.organization_id=_org
      and regexp_replace(coalesce(o.customer_phone,''),'[^0-9]','','g')=v_phone
      and o.status='delivered'
      and o.payment_status='paid'
    group by 1
    order by qty desc, product_name
    limit 1
  ) x;

  v_stage := case
    when v_orders = 0 then 'lead'
    when v_orders >= 5 or v_revenue >= 500 then 'vip'
    else 'customer'
  end;

  insert into public.crm_contacts (
    organization_id,user_id,phone_normalized,name,source,lifecycle_stage,
    first_seen_at,last_activity_at,confirmed_orders,confirmed_revenue,average_ticket,
    first_purchase_at,last_purchase_at,last_order_total,favorite_product,updated_at
  )
  values (
    _org,v_user_id,v_phone,v_name,'orders',v_stage,
    coalesce(v_first_seen,now()),v_last_activity,v_orders,round(v_revenue,2),
    case when v_orders>0 then round(v_revenue/v_orders,2) else 0 end,
    v_first_purchase,v_last_purchase,v_last_total,coalesce(v_favorite,''),now()
  )
  on conflict (organization_id,phone_normalized) do update
  set
    user_id=coalesce(excluded.user_id,public.crm_contacts.user_id),
    name=case when excluded.name<>'' then excluded.name else public.crm_contacts.name end,
    lifecycle_stage=excluded.lifecycle_stage,
    first_seen_at=least(public.crm_contacts.first_seen_at,excluded.first_seen_at),
    last_activity_at=excluded.last_activity_at,
    confirmed_orders=excluded.confirmed_orders,
    confirmed_revenue=excluded.confirmed_revenue,
    average_ticket=excluded.average_ticket,
    first_purchase_at=excluded.first_purchase_at,
    last_purchase_at=excluded.last_purchase_at,
    last_order_total=excluded.last_order_total,
    favorite_product=excluded.favorite_product,
    updated_at=now();
end
$function$;

revoke all on function private.crm_recalculate_contact(uuid,text) from public, anon, authenticated;

create or replace function private.crm_attribute_conversion(_order_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_order public.orders%rowtype;
  v_phone text;
  v_contact uuid;
  v_interaction uuid;
begin
  select * into v_order
  from public.orders
  where id=_order_id
  limit 1;

  if not found
     or v_order.organization_id is null
     or v_order.status <> 'delivered'
     or v_order.payment_status <> 'paid' then
    return;
  end if;

  v_phone := regexp_replace(coalesce(v_order.customer_phone,''),'[^0-9]','','g');
  if length(v_phone)<8 then return; end if;

  select id into v_contact
  from public.crm_contacts
  where organization_id=v_order.organization_id
    and phone_normalized=v_phone
  limit 1;

  if v_contact is null then return; end if;

  select i.id into v_interaction
  from public.crm_interactions i
  where i.organization_id=v_order.organization_id
    and i.contact_id=v_contact
    and i.status in ('opened','sent')
    and i.converted_order_id is null
    and i.created_at <= v_order.created_at
    and i.created_at >= v_order.created_at - interval '30 days'
  order by i.created_at desc
  limit 1;

  if v_interaction is not null then
    update public.crm_interactions
    set status='converted',
        converted_at=coalesce(converted_at,now()),
        converted_order_id=v_order.id,
        attributed_revenue=greatest(coalesce(v_order.total,0),0)
    where id=v_interaction;
  end if;
end
$function$;

revoke all on function private.crm_attribute_conversion(uuid) from public, anon, authenticated;

create or replace function private.crm_orders_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_old_phone text;
  v_new_phone text;
begin
  if tg_op in ('UPDATE','DELETE') then
    v_old_phone := regexp_replace(coalesce(old.customer_phone,''),'[^0-9]','','g');
  end if;
  if tg_op in ('INSERT','UPDATE') then
    v_new_phone := regexp_replace(coalesce(new.customer_phone,''),'[^0-9]','','g');
  end if;

  if tg_op='DELETE' then
    perform private.crm_recalculate_contact(old.organization_id,v_old_phone);
    return old;
  end if;

  if tg_op='UPDATE'
     and (old.organization_id is distinct from new.organization_id
       or v_old_phone is distinct from v_new_phone) then
    perform private.crm_recalculate_contact(old.organization_id,v_old_phone);
  end if;

  perform private.crm_recalculate_contact(new.organization_id,v_new_phone);
  perform private.crm_attribute_conversion(new.id);
  return new;
end
$function$;

drop trigger if exists crm_orders_sync on public.orders;
create trigger crm_orders_sync
after insert or update of organization_id,customer_phone,customer_name,user_id,total,status,payment_status,items
or delete on public.orders
for each row execute function private.crm_orders_sync_trigger();

insert into public.crm_automations (
  organization_id,name,trigger_type,days_threshold,objective,active,auto_send
)
select o.id,
       case d.days
         when 7 then 'Reengajar após 7 dias'
         when 15 then 'Recuperar após 15 dias'
         when 30 then 'Recuperar após 30 dias'
         else 'Recuperar após 60 dias'
       end,
       'inactive',
       d.days,
       'recuperar',
       true,
       false
from public.organizations o
cross join (values (7),(15),(30),(60)) d(days)
on conflict (organization_id,trigger_type,days_threshold) do nothing;

create or replace function public.crm_refresh_tasks(_org uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_inserted integer := 0;
begin
  if not public.crm_can_manage(_org) then
    raise exception 'unauthorized';
  end if;

  with eligible as (
    select
      c.id as contact_id,
      a.id as automation_id,
      (c.last_purchase_at at time zone 'America/Sao_Paulo')::date + a.days_threshold as due_date,
      a.objective,
      row_number() over (
        partition by c.id
        order by a.days_threshold desc
      ) as rn
    from public.crm_contacts c
    join public.crm_automations a
      on a.organization_id=c.organization_id
     and a.active=true
     and a.trigger_type='inactive'
     and a.days_threshold is not null
    where c.organization_id=_org
      and c.last_purchase_at is not null
      and c.consent_status <> 'opt_out'
      and (now() at time zone 'America/Sao_Paulo')::date
          >= (c.last_purchase_at at time zone 'America/Sao_Paulo')::date + a.days_threshold
  ),
  ins as (
    insert into public.crm_tasks (
      organization_id,contact_id,automation_id,due_date,objective
    )
    select _org,contact_id,automation_id,due_date,objective
    from eligible
    where rn=1
    on conflict (contact_id,automation_id,due_date) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('ok',true,'inserted',v_inserted);
end
$function$;

revoke all on function public.crm_refresh_tasks(uuid) from public, anon;
grant execute on function public.crm_refresh_tasks(uuid) to authenticated;

create or replace function public.crm_record_interaction(
  _org uuid,
  _contact_id uuid,
  _objective text,
  _message text,
  _channel text default 'whatsapp',
  _status text default 'opened'
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_id uuid;
  v_consent text;
begin
  if not public.crm_can_manage(_org) then
    raise exception 'unauthorized';
  end if;

  select consent_status into v_consent
  from public.crm_contacts
  where id=_contact_id and organization_id=_org
  limit 1;

  if not found then
    raise exception 'contact_not_found';
  end if;

  if v_consent='opt_out' and _objective in ('recuperar','promocao','novidade','aniversario') then
    raise exception 'marketing_opt_out';
  end if;

  if _channel not in ('whatsapp','phone','email','other') then
    raise exception 'invalid_channel';
  end if;
  if _status not in ('draft','opened','sent','failed','converted','dismissed') then
    raise exception 'invalid_status';
  end if;

  insert into public.crm_interactions (
    organization_id,contact_id,channel,objective,message,status,
    opened_at,sent_at,created_by
  )
  values (
    _org,_contact_id,_channel,left(coalesce(_objective,''),60),
    left(coalesce(_message,''),2000),_status,
    case when _status='opened' then now() else null end,
    case when _status='sent' then now() else null end,
    auth.uid()
  )
  returning id into v_id;

  update public.crm_tasks
  set status=case when _status in ('opened','sent') then 'opened' else status end,
      completed_at=case when _status='sent' then now() else completed_at end
  where organization_id=_org
    and contact_id=_contact_id
    and status='pending';

  return v_id;
end
$function$;

revoke all on function public.crm_record_interaction(uuid,uuid,text,text,text,text) from public, anon;
grant execute on function public.crm_record_interaction(uuid,uuid,text,text,text,text) to authenticated;

create or replace function public.crm_summary(_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_result jsonb;
begin
  if not public.crm_can_manage(_org) then
    raise exception 'unauthorized';
  end if;

  select jsonb_build_object(
    'contacts',count(*),
    'customers',count(*) filter (where lifecycle_stage in ('customer','vip')),
    'leads',count(*) filter (where lifecycle_stage='lead'),
    'vip',count(*) filter (where lifecycle_stage='vip'),
    'inactive_15',count(*) filter (
      where last_purchase_at is not null
        and (now() at time zone 'America/Sao_Paulo')::date
            >= (last_purchase_at at time zone 'America/Sao_Paulo')::date + 15
    ),
    'confirmed_revenue',round(coalesce(sum(confirmed_revenue),0),2),
    'average_ticket',round(
      case when coalesce(sum(confirmed_orders),0)>0
        then coalesce(sum(confirmed_revenue),0)/sum(confirmed_orders)
        else 0 end,2
    ),
    'pending_tasks',(
      select count(*) from public.crm_tasks t
      where t.organization_id=_org and t.status='pending'
    ),
    'conversions_30d',(
      select count(*) from public.crm_interactions i
      where i.organization_id=_org
        and i.converted_at >= now()-interval '30 days'
    ),
    'attributed_revenue_30d',(
      select round(coalesce(sum(i.attributed_revenue),0),2)
      from public.crm_interactions i
      where i.organization_id=_org
        and i.converted_at >= now()-interval '30 days'
    )
  )
  into v_result
  from public.crm_contacts c
  where c.organization_id=_org;

  return coalesce(v_result,'{}'::jsonb);
end
$function$;

revoke all on function public.crm_summary(uuid) from public, anon;
grant execute on function public.crm_summary(uuid) to authenticated;

do $backfill$
declare
  r record;
begin
  for r in
    select distinct
      o.organization_id as org_id,
      regexp_replace(coalesce(o.customer_phone,''),'[^0-9]','','g') as phone
    from public.orders o
    where o.organization_id is not null
      and length(regexp_replace(coalesce(o.customer_phone,''),'[^0-9]','','g')) >= 8
  loop
    perform private.crm_recalculate_contact(r.org_id,r.phone);
  end loop;
end
$backfill$;
