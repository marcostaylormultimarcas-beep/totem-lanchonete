
alter table public.config_fidelidade
  add column if not exists earning_mode text not null default 'spend',
  add column if not exists points_per_real numeric(10,2) not null default 1,
  add column if not exists points_per_order integer not null default 1;

alter table public.config_fidelidade
  drop constraint if exists config_fidelidade_earning_mode_check,
  drop constraint if exists config_fidelidade_points_per_real_check,
  drop constraint if exists config_fidelidade_points_per_order_check;

alter table public.config_fidelidade
  add constraint config_fidelidade_earning_mode_check
    check (earning_mode in ('spend','order')),
  add constraint config_fidelidade_points_per_real_check
    check (points_per_real > 0 and points_per_real <= 1000),
  add constraint config_fidelidade_points_per_order_check
    check (points_per_order > 0 and points_per_order <= 100000);

alter table public.progresso_fidelidade
  add column if not exists user_id uuid,
  add column if not exists points_balance integer not null default 0,
  add column if not exists points_earned_total integer not null default 0,
  add column if not exists points_spent_total integer not null default 0;

create unique index if not exists progresso_fidelidade_org_user_uidx
  on public.progresso_fidelidade(organization_id,user_id)
  where user_id is not null;

alter table public.orders
  add column if not exists loyalty_subtotal numeric(12,2),
  add column if not exists loyalty_discount numeric(12,2),
  add column if not exists loyalty_delivery_fee numeric(12,2),
  add column if not exists loyalty_eligible_amount numeric(12,2);

create table if not exists public.loyalty_rewards (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text not null default '',
  image_url text not null default '',
  points_cost integer not null,
  reward_type text not null default 'benefit',
  product_id uuid references public.products(id) on delete set null,
  estimated_cost numeric(12,2),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_rewards_points_cost_check check (points_cost > 0 and points_cost <= 100000000),
  constraint loyalty_rewards_type_check check (reward_type in ('benefit','product'))
);

create index if not exists loyalty_rewards_org_active_sort_idx
  on public.loyalty_rewards(organization_id,active,sort_order,points_cost);

alter table public.loyalty_rewards enable row level security;

drop policy if exists "owner manage loyalty_rewards" on public.loyalty_rewards;
create policy "owner manage loyalty_rewards"
on public.loyalty_rewards
for all
to authenticated
using (
  private.usuario_dono_org(organization_id,(select auth.uid()))
  or private.eh_super_admin((select auth.uid()))
)
with check (
  private.usuario_dono_org(organization_id,(select auth.uid()))
  or private.eh_super_admin((select auth.uid()))
);

revoke all on table public.loyalty_rewards from public,anon,authenticated;
grant select,insert,update,delete on table public.loyalty_rewards to authenticated;
grant all on table public.loyalty_rewards to service_role;

drop trigger if exists trg_loyalty_rewards_updated_at on public.loyalty_rewards;
create trigger trg_loyalty_rewards_updated_at
before update on public.loyalty_rewards
for each row execute function public.update_updated_at_column();

create or replace function public.visionfood_loyalty_reward_product_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if new.product_id is not null and not exists(
    select 1 from public.products p
    where p.id=new.product_id and p.organization_id=new.organization_id
  ) then
    raise exception 'reward_product_organization_mismatch';
  end if;
  return new;
end
$function$;

revoke all on function public.visionfood_loyalty_reward_product_guard()
  from public,anon,authenticated;

drop trigger if exists trg_loyalty_reward_product_guard on public.loyalty_rewards;
create trigger trg_loyalty_reward_product_guard
before insert or update of organization_id,product_id on public.loyalty_rewards
for each row execute function public.visionfood_loyalty_reward_product_guard();

alter table public.resgates_fidelidade
  add column if not exists reward_id uuid references public.loyalty_rewards(id) on delete set null,
  add column if not exists user_id uuid,
  add column if not exists points_spent integer not null default 0,
  add column if not exists premio_descricao text not null default '';

create index if not exists resgates_fidelidade_org_user_created_idx
  on public.resgates_fidelidade(organization_id,user_id,created_at desc);

create table if not exists public.loyalty_points_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid,
  telefone_cliente text not null default '',
  order_id uuid references public.orders(id) on delete set null,
  reward_id uuid references public.loyalty_rewards(id) on delete set null,
  redemption_id uuid references public.resgates_fidelidade(id) on delete set null,
  entry_type text not null,
  points integer not null,
  balance_after integer not null,
  eligible_amount numeric(12,2),
  description text not null default '',
  created_at timestamptz not null default now(),
  constraint loyalty_points_ledger_type_check
    check (entry_type in ('earn','redeem','reversal','adjustment')),
  constraint loyalty_points_ledger_points_check check (points <> 0)
);

create index if not exists loyalty_points_ledger_org_user_created_idx
  on public.loyalty_points_ledger(organization_id,user_id,created_at desc);
create index if not exists loyalty_points_ledger_org_phone_created_idx
  on public.loyalty_points_ledger(organization_id,telefone_cliente,created_at desc);

create unique index if not exists loyalty_points_ledger_order_entry_uidx
  on public.loyalty_points_ledger(order_id,entry_type)
  where order_id is not null and entry_type in ('earn','reversal');

create unique index if not exists loyalty_points_ledger_redemption_uidx
  on public.loyalty_points_ledger(redemption_id)
  where redemption_id is not null;

alter table public.loyalty_points_ledger enable row level security;

drop policy if exists "loyalty ledger owner or customer read" on public.loyalty_points_ledger;
create policy "loyalty ledger owner or customer read"
on public.loyalty_points_ledger
for select
to authenticated
using (
  user_id=(select auth.uid())
  or private.usuario_dono_org(organization_id,(select auth.uid()))
  or private.eh_super_admin((select auth.uid()))
);

revoke all on table public.loyalty_points_ledger from public,anon,authenticated;
grant select on table public.loyalty_points_ledger to authenticated;
grant all on table public.loyalty_points_ledger to service_role;

insert into public.loyalty_rewards(
  organization_id,title,description,image_url,points_cost,reward_type,estimated_cost,active,sort_order
)
select
  c.organization_id,
  coalesce(nullif(btrim(c.premio_recompensa),''),'Prêmio fidelidade'),
  coalesce(c.descricao_premio,''),
  coalesce(c.premio_imagem,''),
  greatest(
    1,
    ceil(greatest(coalesce(c.valor_minimo_pedido,0),1) * greatest(coalesce(c.meta_pedidos,10),1))::integer
  ),
  'benefit',
  null,
  true,
  0
from public.config_fidelidade c
where not exists (
  select 1 from public.loyalty_rewards r
  where r.organization_id=c.organization_id
);

create or replace function public.visionfood_seed_loyalty_amounts()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  item_subtotal numeric:=0;
begin
  if jsonb_typeof(coalesce(new.items,'[]'::jsonb))='array' then
    select coalesce(sum(
      case
        when jsonb_typeof(x)='object' and coalesce(x->>'total','') ~ '^[0-9]+([.][0-9]+)?$'
          then (x->>'total')::numeric
        else 0
      end
    ),0)
    into item_subtotal
    from jsonb_array_elements(coalesce(new.items,'[]'::jsonb)) x;
  end if;

  if new.loyalty_subtotal is null and item_subtotal>0 then
    new.loyalty_subtotal:=round(item_subtotal,2);
  end if;

  if new.order_type not in ('delivery','viagem') and new.loyalty_eligible_amount is null and item_subtotal>0 then
    new.loyalty_delivery_fee:=coalesce(new.loyalty_delivery_fee,0);
    new.loyalty_discount:=coalesce(new.loyalty_discount,greatest(item_subtotal-coalesce(new.total,item_subtotal),0));
    new.loyalty_eligible_amount:=round(greatest(least(item_subtotal,coalesce(new.total,item_subtotal)),0),2);
  end if;

  return new;
end
$function$;

drop trigger if exists trg_visionfood_seed_loyalty_amounts on public.orders;
create trigger trg_visionfood_seed_loyalty_amounts
before insert on public.orders
for each row execute function public.visionfood_seed_loyalty_amounts();

create or replace function public.create_order_checkout_v2(
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
  _delivery_context jsonb default '{}'::jsonb
)
returns table(id uuid,order_number text)
language plpgsql
security definer
set search_path=''
as $function$
declare
  _quote jsonb;
  _server_fee numeric;
  _id uuid;
  _number text;
  _method text;
  _pay_cash boolean:=true;
  _pay_pix boolean:=true;
  _pay_terminal boolean:=false;
  _pix_key text:='';
  _loyalty_subtotal numeric:=0;
  _loyalty_discount numeric:=0;
  _loyalty_fee numeric:=0;
  _loyalty_eligible numeric:=0;
begin
  if nullif(btrim(coalesce(_customer_name,'')),'') is null or length(btrim(_customer_name))>120 then
    raise exception 'invalid customer_name';
  end if;
  if length(coalesce(_customer_phone,''))>30
     or length(coalesce(_customer_cpf,''))>20
     or length(coalesce(_delivery_address,''))>500
     or length(coalesce(_delivery_reference,''))>300
     or length(coalesce(_delivery_recipient,''))>120
     or length(coalesce(_bairro_nome,''))>120
     or length(coalesce(_coupon_code,''))>100 then
    raise exception 'checkout field exceeds maximum length';
  end if;

  _method:=lower(btrim(coalesce(_payment_method,'')));
  if _method not in ('cash','pix','terminal') then
    raise exception 'invalid payment_method';
  end if;

  select
    coalesce(s.pay_cash_enabled,true),
    coalesce(s.pay_pix_enabled,true),
    coalesce(s.pay_card_terminal_enabled,false),
    coalesce(s.pix_key_manual,'')
  into _pay_cash,_pay_pix,_pay_terminal,_pix_key
  from public.settings s
  where s.organization_id=_organization_id
  limit 1;

  if not found then
    _pay_cash:=true;
    _pay_pix:=false;
    _pay_terminal:=false;
    _pix_key:='';
  end if;

  if (_method='cash' and not _pay_cash)
     or (_method='pix' and (not _pay_pix or nullif(btrim(_pix_key),'') is null))
     or (_method='terminal' and not _pay_terminal) then
    raise exception 'payment_method_disabled';
  end if;

  _quote:=public.quote_order_checkout_v2(
    _organization_id,_order_type,_bairro_id,_delivery_fee,_items,_coupon_code,_delivery_context
  );
  _server_fee:=coalesce((_quote->>'delivery_fee')::numeric,0);
  _loyalty_subtotal:=greatest(coalesce((_quote->>'subtotal')::numeric,0),0);
  _loyalty_discount:=greatest(coalesce((_quote->>'discount')::numeric,0),0);
  _loyalty_fee:=greatest(coalesce((_quote->>'delivery_fee')::numeric,0),0);
  _loyalty_eligible:=round(greatest(_loyalty_subtotal-_loyalty_discount,0),2);

  select x.id,x.order_number
    into _id,_number
  from public.create_order_checkout(
    _organization_id,_customer_name,_customer_phone,_customer_cpf,_order_type,
    _delivery_address,_delivery_reference,_delivery_recipient,_bairro_id,_bairro_nome,
    _server_fee,_items,_total,_method,_scheduled_for,_coupon_code
  ) x;

  update public.orders
     set bairro_nome=left(btrim(coalesce(_bairro_nome,'')),120),
         loyalty_subtotal=round(_loyalty_subtotal,2),
         loyalty_discount=round(_loyalty_discount,2),
         loyalty_delivery_fee=round(_loyalty_fee,2),
         loyalty_eligible_amount=_loyalty_eligible
   where orders.id=_id;

  return query select _id,_number;
end
$function$;

create or replace function public.visionfood_apply_loyalty_for_order(_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  o public.orders%rowtype;
  cfg public.config_fidelidade%rowtype;
  wallet public.progresso_fidelidade%rowtype;
  phone text;
  identity_key text;
  eligible numeric:=0;
  points_to_add integer:=0;
  new_balance integer:=0;
  new_stamps integer:=0;
  prior_earn public.loyalty_points_ledger%rowtype;
begin
  select * into o
  from public.orders
  where id=_order_id
  for update;

  if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;
  if o.status<>'delivered' then return jsonb_build_object('ok',false,'reason','order_not_delivered'); end if;
  if o.payment_status is distinct from 'paid' then return jsonb_build_object('ok',false,'reason','payment_not_confirmed'); end if;

  select * into cfg
  from public.config_fidelidade
  where organization_id=o.organization_id
  limit 1;

  if not found or coalesce(cfg.ativo,false) is not true then
    return jsonb_build_object('ok',false,'reason','inactive');
  end if;
  if cfg.data_inicio is not null and current_date<cfg.data_inicio then
    return jsonb_build_object('ok',false,'reason','not_started');
  end if;
  if cfg.data_fim is not null and current_date>cfg.data_fim then
    return jsonb_build_object('ok',false,'reason','expired');
  end if;

  phone:=regexp_replace(coalesce(o.customer_phone,''),'\D','','g');
  if length(phone)<8 then return jsonb_build_object('ok',false,'reason','no_phone'); end if;

  if coalesce(cfg.earning_mode,'spend')='spend' then
    if o.loyalty_eligible_amount is null then
      if o.order_type in ('delivery','viagem') then
        return jsonb_build_object('ok',false,'reason','eligible_amount_unknown');
      end if;
      eligible:=greatest(least(
        coalesce(o.loyalty_subtotal,o.total,0),
        coalesce(o.total,0)
      ),0);
    else
      eligible:=greatest(o.loyalty_eligible_amount,0);
    end if;

    if eligible<greatest(coalesce(cfg.valor_minimo_pedido,0),0) then
      return jsonb_build_object('ok',false,'reason','below_minimum');
    end if;

    points_to_add:=floor(eligible*greatest(coalesce(cfg.points_per_real,1),0.01))::integer;
  else
    eligible:=greatest(coalesce(o.loyalty_eligible_amount,o.total,0),0);
    if eligible<greatest(coalesce(cfg.valor_minimo_pedido,0),0) then
      return jsonb_build_object('ok',false,'reason','below_minimum');
    end if;
    points_to_add:=greatest(coalesce(cfg.points_per_order,1),1);
  end if;

  if points_to_add<=0 then return jsonb_build_object('ok',false,'reason','no_points'); end if;

  identity_key:=case
    when o.user_id is not null then 'user:'||o.user_id::text
    else 'phone:'||phone
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(o.organization_id::text||':'||identity_key,0)
  );

  if o.user_id is not null then
    select * into wallet
    from public.progresso_fidelidade pf
    where pf.organization_id=o.organization_id and pf.user_id=o.user_id
    limit 1
    for update;
  end if;

  if wallet.id is null then
    select * into wallet
    from public.progresso_fidelidade pf
    where pf.organization_id=o.organization_id and pf.telefone_cliente=phone
    limit 1
    for update;

    if wallet.id is not null and wallet.user_id is not null and o.user_id is not null
       and wallet.user_id is distinct from o.user_id then
      return jsonb_build_object('ok',false,'reason','identity_conflict');
    end if;
  end if;

  begin
    insert into public.pedidos_carimbados(pedido_id,organization_id,telefone_cliente)
    values(o.id,o.organization_id,phone);
  exception when unique_violation then
    select * into prior_earn
    from public.loyalty_points_ledger l
    where l.order_id=o.id and l.entry_type='earn'
    limit 1;

    return jsonb_build_object(
      'ok',true,
      'already_stamped',true,
      'awarded',false,
      'points_awarded',coalesce(prior_earn.points,0),
      'balance',case
        when wallet.id is not null then coalesce(wallet.points_balance,0)
        else coalesce(prior_earn.balance_after,0)
      end,
      'eligible_amount',prior_earn.eligible_amount
    );
  end;

  if wallet.id is null then
    insert into public.progresso_fidelidade(
      organization_id,telefone_cliente,user_id,quantidade_carimbos,premios_resgatados,
      ultimo_pedido_id,points_balance,points_earned_total,points_spent_total
    )
    values(
      o.organization_id,phone,o.user_id,0,0,o.id,
      points_to_add,points_to_add,0
    )
    returning * into wallet;
  else
    new_stamps:=case
      when coalesce(cfg.earning_mode,'spend')='order'
        then mod(coalesce(wallet.quantidade_carimbos,0)+1,greatest(coalesce(cfg.meta_pedidos,10),1))
      else coalesce(wallet.quantidade_carimbos,0)
    end;

    update public.progresso_fidelidade
       set user_id=coalesce(user_id,o.user_id),
           quantidade_carimbos=new_stamps,
           ultimo_pedido_id=o.id,
           points_balance=coalesce(points_balance,0)+points_to_add,
           points_earned_total=coalesce(points_earned_total,0)+points_to_add,
           updated_at=now()
     where id=wallet.id
     returning * into wallet;
  end if;

  new_balance:=coalesce(wallet.points_balance,0);

  insert into public.loyalty_points_ledger(
    organization_id,user_id,telefone_cliente,order_id,entry_type,
    points,balance_after,eligible_amount,description
  )
  values(
    o.organization_id,o.user_id,phone,o.id,'earn',
    points_to_add,new_balance,eligible,
    'Pedido #'||coalesce(o.order_number,'')
  );

  return jsonb_build_object(
    'ok',true,
    'awarded',true,
    'points_awarded',points_to_add,
    'balance',new_balance,
    'eligible_amount',eligible,
    'earning_mode',coalesce(cfg.earning_mode,'spend')
  );
end
$function$;

revoke all on function public.visionfood_apply_loyalty_for_order(uuid)
  from public,anon,authenticated;

create or replace function public.visionfood_reverse_loyalty_for_order(_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  earn public.loyalty_points_ledger%rowtype;
  wallet public.progresso_fidelidade%rowtype;
  new_balance integer;
begin
  select * into earn
  from public.loyalty_points_ledger l
  where l.order_id=_order_id and l.entry_type='earn'
  limit 1;

  if not found then return jsonb_build_object('ok',true,'reversed',false,'reason','not_awarded'); end if;

  if exists(
    select 1 from public.loyalty_points_ledger l
    where l.order_id=_order_id and l.entry_type='reversal'
  ) then
    return jsonb_build_object('ok',true,'reversed',false,'reason','already_reversed');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      earn.organization_id::text||':'||
      coalesce('user:'||earn.user_id::text,'phone:'||earn.telefone_cliente),
      0
    )
  );

  if earn.user_id is not null then
    select * into wallet
    from public.progresso_fidelidade pf
    where pf.organization_id=earn.organization_id and pf.user_id=earn.user_id
    limit 1 for update;
  end if;

  if wallet.id is null then
    select * into wallet
    from public.progresso_fidelidade pf
    where pf.organization_id=earn.organization_id
      and pf.telefone_cliente=earn.telefone_cliente
    limit 1 for update;
  end if;

  if wallet.id is null then
    return jsonb_build_object('ok',false,'reason','wallet_not_found');
  end if;

  new_balance:=coalesce(wallet.points_balance,0)-abs(earn.points);

  update public.progresso_fidelidade
     set points_balance=new_balance,updated_at=now()
   where id=wallet.id;

  insert into public.loyalty_points_ledger(
    organization_id,user_id,telefone_cliente,order_id,entry_type,
    points,balance_after,eligible_amount,description
  )
  values(
    earn.organization_id,earn.user_id,earn.telefone_cliente,_order_id,'reversal',
    -abs(earn.points),new_balance,earn.eligible_amount,'Estorno de '||earn.description
  );

  return jsonb_build_object(
    'ok',true,'reversed',true,'points_reversed',abs(earn.points),'balance',new_balance
  );
end
$function$;

revoke all on function public.visionfood_reverse_loyalty_for_order(uuid)
  from public,anon,authenticated;

create or replace function public.grant_loyalty_stamp(_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  u uuid:=auth.uid();
  o public.orders%rowtype;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;

  select * into o from public.orders where id=_order_id;
  if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;

  if not private.usuario_dono_org(o.organization_id,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  return public.visionfood_apply_loyalty_for_order(_order_id);
end
$function$;

revoke all on function public.grant_loyalty_stamp(uuid) from public,anon;
grant execute on function public.grant_loyalty_stamp(uuid) to authenticated;

create or replace function public.visionfood_auto_loyalty_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  begin
    if new.status='delivered'
       and new.payment_status='paid'
       and (
         old.status is distinct from new.status
         or old.payment_status is distinct from new.payment_status
       ) then
      perform public.visionfood_apply_loyalty_for_order(new.id);
    elsif (
      new.status='cancelled'
      or new.payment_status='refunded'
    ) and (
      old.status is distinct from new.status
      or old.payment_status is distinct from new.payment_status
    ) then
      perform public.visionfood_reverse_loyalty_for_order(new.id);
    end if;
  exception when others then
    raise warning 'visionfood_auto_loyalty_failed order=% sqlstate=%',new.id,sqlstate;
  end;
  return new;
end
$function$;

revoke all on function public.visionfood_auto_loyalty_trigger()
  from public,anon,authenticated;

drop trigger if exists trg_visionfood_auto_loyalty on public.orders;
create trigger trg_visionfood_auto_loyalty
after update of status,payment_status on public.orders
for each row
execute function public.visionfood_auto_loyalty_trigger();

create or replace function public.loyalty_customer_state(_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  u uuid:=auth.uid();
  phone text:='';
  cfg public.config_fidelidade%rowtype;
  wallet public.progresso_fidelidade%rowtype;
  cfg_json jsonb;
  catalog jsonb:='[]'::jsonb;
  redemptions jsonb:='[]'::jsonb;
  history jsonb:='[]'::jsonb;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;

  select * into cfg
  from public.config_fidelidade
  where organization_id=_organization_id
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok',true,'config',null,'phone','','points_balance',0,
      'points_earned_total',0,'points_spent_total',0,
      'catalog','[]'::jsonb,'redemptions','[]'::jsonb,'history','[]'::jsonb
    );
  end if;

  cfg_json:=jsonb_build_object(
    'ativo',coalesce(cfg.ativo,false),
    'earning_mode',coalesce(cfg.earning_mode,'spend'),
    'points_per_real',coalesce(cfg.points_per_real,1),
    'points_per_order',coalesce(cfg.points_per_order,1),
    'valor_minimo_pedido',coalesce(cfg.valor_minimo_pedido,0),
    'meta_pedidos',coalesce(cfg.meta_pedidos,10)
  );

  select * into wallet
  from public.progresso_fidelidade pf
  where pf.organization_id=_organization_id and pf.user_id=u
  limit 1;

  if wallet.id is null then
    select regexp_replace(coalesce(o.customer_phone,''),'\D','','g')
      into phone
    from public.orders o
    where o.organization_id=_organization_id
      and o.user_id=u
      and length(regexp_replace(coalesce(o.customer_phone,''),'\D','','g'))>=8
    order by o.created_at desc
    limit 1;

    if coalesce(length(phone),0)>=8 then
      select * into wallet
      from public.progresso_fidelidade pf
      where pf.organization_id=_organization_id
        and pf.telefone_cliente=phone
        and (pf.user_id is null or pf.user_id=u)
      limit 1;
    end if;
  else
    phone:=coalesce(wallet.telefone_cliente,'');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',r.id,
      'title',r.title,
      'description',r.description,
      'image_url',r.image_url,
      'points_cost',r.points_cost,
      'reward_type',r.reward_type,
      'product_id',r.product_id
    ) order by r.points_cost,r.sort_order,r.created_at
  ),'[]'::jsonb)
  into catalog
  from public.loyalty_rewards r
  where r.organization_id=_organization_id and r.active=true;

  if wallet.id is not null then
    phone:=coalesce(wallet.telefone_cliente,phone);

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',r.id,
        'reward_id',r.reward_id,
        'premio_texto',r.premio_texto,
        'premio_descricao',r.premio_descricao,
        'premio_imagem',r.premio_imagem,
        'codigo_resgate',r.codigo_resgate,
        'points_spent',r.points_spent,
        'status',r.status,
        'created_at',r.created_at,
        'used_at',r.used_at
      ) order by r.created_at desc
    ),'[]'::jsonb)
    into redemptions
    from (
      select *
      from public.resgates_fidelidade x
      where x.organization_id=_organization_id
        and (
          x.user_id=u
          or (x.user_id is null and x.telefone_cliente=wallet.telefone_cliente)
        )
      order by x.created_at desc
      limit 50
    ) r;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',l.id,
        'entry_type',l.entry_type,
        'points',l.points,
        'balance_after',l.balance_after,
        'eligible_amount',l.eligible_amount,
        'description',l.description,
        'created_at',l.created_at
      ) order by l.created_at desc
    ),'[]'::jsonb)
    into history
    from (
      select *
      from public.loyalty_points_ledger x
      where x.organization_id=_organization_id
        and (
          x.user_id=u
          or (x.user_id is null and x.telefone_cliente=wallet.telefone_cliente)
        )
      order by x.created_at desc
      limit 50
    ) l;
  end if;

  return jsonb_build_object(
    'ok',true,
    'phone',phone,
    'config',cfg_json,
    'points_balance',coalesce(wallet.points_balance,0),
    'points_earned_total',coalesce(wallet.points_earned_total,0),
    'points_spent_total',coalesce(wallet.points_spent_total,0),
    'catalog',catalog,
    'redemptions',redemptions,
    'history',history
  );
end
$function$;

revoke all on function public.loyalty_customer_state(uuid) from public,anon;
grant execute on function public.loyalty_customer_state(uuid) to authenticated;

create or replace function public.loyalty_redeem_reward(
  _organization_id uuid,
  _reward_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  u uuid:=auth.uid();
  cfg public.config_fidelidade%rowtype;
  reward public.loyalty_rewards%rowtype;
  wallet public.progresso_fidelidade%rowtype;
  phone text:='';
  redemption_id uuid;
  code text;
  new_balance integer;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;

  select * into cfg
  from public.config_fidelidade
  where organization_id=_organization_id
  limit 1;

  if not found or coalesce(cfg.ativo,false) is not true then
    return jsonb_build_object('ok',false,'reason','inactive');
  end if;
  if cfg.data_inicio is not null and current_date<cfg.data_inicio then
    return jsonb_build_object('ok',false,'reason','not_started');
  end if;
  if cfg.data_fim is not null and current_date>cfg.data_fim then
    return jsonb_build_object('ok',false,'reason','expired');
  end if;

  select * into reward
  from public.loyalty_rewards r
  where r.id=_reward_id and r.organization_id=_organization_id and r.active=true
  for update;

  if not found then return jsonb_build_object('ok',false,'reason','reward_not_found'); end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_organization_id::text||':user:'||u::text,0)
  );

  select * into wallet
  from public.progresso_fidelidade pf
  where pf.organization_id=_organization_id and pf.user_id=u
  limit 1
  for update;

  if wallet.id is null then
    select regexp_replace(coalesce(o.customer_phone,''),'\D','','g')
      into phone
    from public.orders o
    where o.organization_id=_organization_id
      and o.user_id=u
      and length(regexp_replace(coalesce(o.customer_phone,''),'\D','','g'))>=8
    order by o.created_at desc
    limit 1;

    if coalesce(length(phone),0)<8 then
      return jsonb_build_object('ok',false,'reason','wallet_not_found');
    end if;

    select * into wallet
    from public.progresso_fidelidade pf
    where pf.organization_id=_organization_id and pf.telefone_cliente=phone
    limit 1
    for update;

    if wallet.id is null then return jsonb_build_object('ok',false,'reason','wallet_not_found'); end if;
    if wallet.user_id is not null and wallet.user_id is distinct from u then
      return jsonb_build_object('ok',false,'reason','identity_conflict');
    end if;

    if wallet.user_id is null then
      update public.progresso_fidelidade
         set user_id=u,updated_at=now()
       where id=wallet.id
       returning * into wallet;
    end if;
  end if;

  if coalesce(wallet.points_balance,0)<reward.points_cost then
    return jsonb_build_object(
      'ok',false,'reason','insufficient_points',
      'balance',coalesce(wallet.points_balance,0),
      'required',reward.points_cost
    );
  end if;

  new_balance:=wallet.points_balance-reward.points_cost;
  code:='FID-'||upper(substring(replace(extensions.gen_random_uuid()::text,'-','') from 1 for 8));

  insert into public.resgates_fidelidade(
    organization_id,telefone_cliente,user_id,reward_id,
    premio_texto,premio_descricao,premio_imagem,codigo_resgate,
    points_spent,status
  )
  values(
    _organization_id,coalesce(wallet.telefone_cliente,''),u,reward.id,
    reward.title,reward.description,reward.image_url,code,
    reward.points_cost,'pendente'
  )
  returning id into redemption_id;

  update public.progresso_fidelidade
     set points_balance=new_balance,
         points_spent_total=coalesce(points_spent_total,0)+reward.points_cost,
         premios_resgatados=coalesce(premios_resgatados,0)+1,
         updated_at=now()
   where id=wallet.id;

  insert into public.loyalty_points_ledger(
    organization_id,user_id,telefone_cliente,reward_id,redemption_id,
    entry_type,points,balance_after,description
  )
  values(
    _organization_id,u,coalesce(wallet.telefone_cliente,''),reward.id,redemption_id,
    'redeem',-reward.points_cost,new_balance,'Resgate: '||reward.title
  );

  return jsonb_build_object(
    'ok',true,
    'redemption_id',redemption_id,
    'code',code,
    'balance',new_balance,
    'points_spent',reward.points_cost,
    'reward',jsonb_build_object(
      'id',reward.id,'title',reward.title,'description',reward.description,'image_url',reward.image_url
    )
  );
end
$function$;

revoke all on function public.loyalty_redeem_reward(uuid,uuid) from public,anon;
grant execute on function public.loyalty_redeem_reward(uuid,uuid) to authenticated;

create or replace function public.visionfood_public_loyalty_config(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  select case
    when coalesce(
      (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
      true
    ) then '{}'::jsonb
    else coalesce((
      select jsonb_build_object(
        'ativo',coalesce(c.ativo,false),
        'earning_mode',coalesce(c.earning_mode,'spend'),
        'points_per_real',greatest(coalesce(c.points_per_real,1),0.01),
        'points_per_order',greatest(coalesce(c.points_per_order,1),1),
        'valor_minimo_pedido',greatest(coalesce(c.valor_minimo_pedido,0),0),
        'meta_pedidos',greatest(coalesce(c.meta_pedidos,10),1),
        'premio_recompensa',coalesce(c.premio_recompensa,''),
        'descricao_premio',coalesce(c.descricao_premio,''),
        'premio_imagem',coalesce(c.premio_imagem,''),
        'rewards',coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id',r.id,
              'title',r.title,
              'description',r.description,
              'image_url',r.image_url,
              'points_cost',r.points_cost,
              'reward_type',r.reward_type,
              'product_id',r.product_id
            )
            order by r.points_cost,r.sort_order,r.created_at
          )
          from public.loyalty_rewards r
          where r.organization_id=c.organization_id and r.active=true
        ),'[]'::jsonb)
      )
      from public.config_fidelidade c
      where c.organization_id=_org
        and coalesce(c.ativo,false)=true
        and (c.data_inicio is null or current_date>=c.data_inicio)
        and (c.data_fim is null or current_date<=c.data_fim)
      order by c.updated_at desc nulls last,c.created_at desc nulls last,c.id desc
      limit 1
    ),'{}'::jsonb)
  end
$function$;

revoke all on function public.visionfood_public_loyalty_config(uuid) from public;
grant execute on function public.visionfood_public_loyalty_config(uuid) to anon,authenticated;

create or replace function public.loyalty_admin_summary(_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  u uuid:=auth.uid();
  result jsonb;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  if not private.usuario_dono_org(_organization_id,u) and not private.eh_super_admin(u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  select jsonb_build_object(
    'ok',true,
    'active_customers',(
      select count(*) from public.progresso_fidelidade p
      where p.organization_id=_organization_id and coalesce(p.points_earned_total,0)>0
    ),
    'points_issued',coalesce((
      select sum(l.points) from public.loyalty_points_ledger l
      where l.organization_id=_organization_id and l.entry_type='earn'
    ),0),
    'points_reversed',coalesce((
      select sum(abs(l.points)) from public.loyalty_points_ledger l
      where l.organization_id=_organization_id and l.entry_type='reversal'
    ),0),
    'points_spent',coalesce((
      select sum(abs(l.points)) from public.loyalty_points_ledger l
      where l.organization_id=_organization_id and l.entry_type='redeem'
    ),0),
    'outstanding_points',coalesce((
      select sum(greatest(p.points_balance,0)) from public.progresso_fidelidade p
      where p.organization_id=_organization_id
    ),0),
    'pending_rewards',(
      select count(*) from public.resgates_fidelidade r
      where r.organization_id=_organization_id and r.status='pendente'
    )
  )
  into result;

  return result;
end
$function$;

revoke all on function public.loyalty_admin_summary(uuid) from public,anon;
grant execute on function public.loyalty_admin_summary(uuid) to authenticated;
