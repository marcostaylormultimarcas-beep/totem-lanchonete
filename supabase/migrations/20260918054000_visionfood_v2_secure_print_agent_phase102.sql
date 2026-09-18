alter table public.configuracoes_impressao
  add column if not exists printer_ip text not null default '',
  add column if not exists printer_port integer not null default 9100,
  add column if not exists paper_width integer not null default 48,
  add column if not exists last_seen_at timestamptz,
  add column if not exists webhook_alerta_url text not null default '',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists agent_token_hash text;

update public.configuracoes_impressao
set enabled=coalesce(enabled,active,ativo,true),
    auto_print=coalesce(auto_print,impressao_automatica,false),
    paper_width=case
      when coalesce(largura_papel,'') ~ '^[0-9]+$' then greatest(32,least(48,largura_papel::integer))
      else coalesce(paper_width,48)
    end,
    webhook_alerta_url=coalesce(nullif(webhook_alerta_url,''),webhook_url,''),
    agent_token_hash=coalesce(
      agent_token_hash,
      case when nullif(token_agente,'') is not null then encode(extensions.digest(token_agente,'sha256'),'hex') end,
      case when nullif(token,'') is not null then encode(extensions.digest(token,'sha256'),'hex') end
    ),
    updated_at=now();

update public.configuracoes_impressao set token=null,token_agente=null
where token is not null or token_agente is not null;

create unique index if not exists configuracoes_impressao_org_unique
on public.configuracoes_impressao(organization_id)
where organization_id is not null;

alter table public.configuracoes_impressao enable row level security;
drop policy if exists print_config_owner_select on public.configuracoes_impressao;
drop policy if exists print_config_owner_insert on public.configuracoes_impressao;
drop policy if exists print_config_owner_update on public.configuracoes_impressao;
create policy print_config_owner_select on public.configuracoes_impressao
for select to authenticated using(public.usuario_dono_org(organization_id,(select auth.uid())));
create policy print_config_owner_insert on public.configuracoes_impressao
for insert to authenticated with check(public.usuario_dono_org(organization_id,(select auth.uid())));
create policy print_config_owner_update on public.configuracoes_impressao
for update to authenticated
using(public.usuario_dono_org(organization_id,(select auth.uid())))
with check(public.usuario_dono_org(organization_id,(select auth.uid())));
revoke all on table public.configuracoes_impressao from public,anon,authenticated;
grant select,insert,update on table public.configuracoes_impressao to authenticated;
grant all on table public.configuracoes_impressao to service_role;

create table if not exists public.logs_impressao(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  status text not null default 'info',
  message text not null default '',
  printer_ip text not null default '',
  payload_size integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_logs_impressao_org_created on public.logs_impressao(organization_id,created_at desc);
alter table public.logs_impressao enable row level security;
drop policy if exists logs_impressao_owner_select on public.logs_impressao;
drop policy if exists logs_impressao_owner_insert on public.logs_impressao;
create policy logs_impressao_owner_select on public.logs_impressao
for select to authenticated using(public.usuario_dono_org(organization_id,(select auth.uid())));
create policy logs_impressao_owner_insert on public.logs_impressao
for insert to authenticated with check(public.usuario_dono_org(organization_id,(select auth.uid())));
revoke all on table public.logs_impressao from public,anon,authenticated;
grant select,insert on table public.logs_impressao to authenticated;
grant all on table public.logs_impressao to service_role;

alter table public.orders
  add column if not exists print_status text not null default 'pending',
  add column if not exists printed_at timestamptz,
  add column if not exists print_attempts integer not null default 0,
  add column if not exists print_error text not null default '',
  add column if not exists print_claimed_at timestamptz;
create index if not exists orders_print_queue_idx on public.orders(organization_id,print_status,created_at);

create or replace function public.queue_order_for_printing()
returns trigger language plpgsql security definer set search_path='' as $$
declare cfg public.configuracoes_impressao%rowtype;
begin
  if new.status not in ('preparing','ready','out_for_delivery','delivered') then return new; end if;
  if new.payment_status is distinct from 'paid' then return new; end if;
  if coalesce(new.print_status,'pending') not in ('pending','manual_pending') then return new; end if;
  select * into cfg from public.configuracoes_impressao where organization_id=new.organization_id limit 1;
  if not found or coalesce(cfg.enabled,false) is not true then return new; end if;
  new.print_status:=case when coalesce(cfg.auto_print,false) then 'queued' else 'manual_pending' end;
  new.print_error:='';
  return new;
end$$;
revoke all on function public.queue_order_for_printing() from public,anon,authenticated;

drop trigger if exists trg_queue_order_print on public.orders;
drop trigger if exists trg_queue_order_for_printing on public.orders;
drop trigger if exists trg_zz_queue_order_print on public.orders;
create trigger trg_zz_queue_order_print
before insert or update of status,payment_status on public.orders
for each row execute function public.queue_order_for_printing();

create or replace function public.print_agent_rotate_token(_org uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); raw_token text; token_hash text;
begin
  if u is null or not public.usuario_dono_org(_org,u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  token_hash:=encode(extensions.digest(raw_token,'sha256'),'hex');
  insert into public.configuracoes_impressao(organization_id,enabled,auto_print,agent_token_hash,updated_at)
  values(_org,true,true,token_hash,now())
  on conflict(organization_id) where organization_id is not null
  do update set agent_token_hash=excluded.agent_token_hash,updated_at=now();
  return jsonb_build_object('ok',true,'token',raw_token);
end$$;
revoke all on function public.print_agent_rotate_token(uuid) from public,anon;
grant execute on function public.print_agent_rotate_token(uuid) to authenticated;

create or replace function public.print_agent_authenticate(_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.configuracoes_impressao%rowtype; org public.organizations%rowtype; h text;
begin
  if length(coalesce(_token,''))<32 then return jsonb_build_object('ok',false,'reason','invalid_token'); end if;
  h:=encode(extensions.digest(_token,'sha256'),'hex');
  select * into cfg from public.configuracoes_impressao where agent_token_hash=h limit 1;
  if not found then return jsonb_build_object('ok',false,'reason','invalid_token'); end if;
  if coalesce(cfg.enabled,false) is not true then return jsonb_build_object('ok',false,'reason','disabled'); end if;
  update public.configuracoes_impressao set last_seen_at=now(),updated_at=now() where id=cfg.id;
  select * into org from public.organizations where id=cfg.organization_id;
  return jsonb_build_object('ok',true,'organization_id',cfg.organization_id,'org_name',coalesce(org.name,''),'paper_width',cfg.paper_width,'auto_print',coalesce(cfg.auto_print,false));
end$$;
revoke all on function public.print_agent_authenticate(text) from public,anon,authenticated;
grant execute on function public.print_agent_authenticate(text) to service_role;

create or replace function public.print_agent_claim_jobs(_token text,_limit integer default 10)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.configuracoes_impressao%rowtype; h text; rows jsonb;
begin
  if length(coalesce(_token,''))<32 then return jsonb_build_object('ok',false,'reason','invalid_token'); end if;
  h:=encode(extensions.digest(_token,'sha256'),'hex');
  select * into cfg from public.configuracoes_impressao where agent_token_hash=h limit 1;
  if not found then return jsonb_build_object('ok',false,'reason','invalid_token'); end if;
  if coalesce(cfg.enabled,false) is not true then return jsonb_build_object('ok',false,'reason','disabled'); end if;
  update public.configuracoes_impressao set last_seen_at=now(),updated_at=now() where id=cfg.id;
  with claimed as (
    select id from public.orders
    where organization_id=cfg.organization_id and payment_status='paid'
      and (print_status in ('queued','pendente_impressao') or (print_status='printing' and print_claimed_at<now()-interval '3 minutes'))
      and created_at>now()-interval '2 days'
    order by created_at limit greatest(1,least(coalesce(_limit,10),25)) for update skip locked
  ), upd as (
    update public.orders o set print_status='printing',print_attempts=coalesce(o.print_attempts,0)+1,print_claimed_at=now(),updated_at=now()
    from claimed where o.id=claimed.id returning o.*
  )
  select coalesce(jsonb_agg(to_jsonb(upd.*) order by upd.created_at),'[]'::jsonb) into rows from upd;
  return jsonb_build_object('ok',true,'organization_id',cfg.organization_id,'jobs',rows);
end$$;
revoke all on function public.print_agent_claim_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.print_agent_claim_jobs(text,integer) to service_role;

create or replace function public.print_agent_ack(_token text,_order_id uuid,_success boolean,_error text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.configuracoes_impressao%rowtype; o public.orders%rowtype; h text;
begin
  if length(coalesce(_token,''))<32 then return jsonb_build_object('ok',false,'reason','invalid_token'); end if;
  h:=encode(extensions.digest(_token,'sha256'),'hex');
  select * into cfg from public.configuracoes_impressao where agent_token_hash=h limit 1;
  if not found then return jsonb_build_object('ok',false,'reason','invalid_token'); end if;
  select * into o from public.orders where id=_order_id and organization_id=cfg.organization_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if _success then
    update public.orders set print_status='printed',printed_at=now(),print_error='',print_claimed_at=null,updated_at=now() where id=o.id;
    insert into public.logs_impressao(organization_id,order_id,status,message,printer_ip)
    values(cfg.organization_id,o.id,'printed','Pedido impresso com sucesso',cfg.printer_ip);
  else
    update public.orders set print_status='pendente_impressao',print_error=left(coalesce(_error,''),500),print_claimed_at=null,updated_at=now() where id=o.id;
    insert into public.logs_impressao(organization_id,order_id,status,message,printer_ip)
    values(cfg.organization_id,o.id,'failure',left(coalesce(_error,'Falha de impressão'),500),cfg.printer_ip);
  end if;
  update public.configuracoes_impressao set last_seen_at=now(),updated_at=now() where id=cfg.id;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.print_agent_ack(text,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.print_agent_ack(text,uuid,boolean,text) to service_role;
