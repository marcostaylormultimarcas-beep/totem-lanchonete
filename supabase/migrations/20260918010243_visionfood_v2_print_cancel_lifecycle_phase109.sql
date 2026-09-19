
create or replace function public.queue_order_for_printing()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.configuracoes_impressao%rowtype;
begin
  if new.status='cancelled' then
    new.print_status:='cancelled';
    new.print_error:='Pedido cancelado';
    new.print_claimed_at:=null;
    return new;
  end if;

  if new.status not in ('preparing','ready','out_for_delivery','delivered') then
    return new;
  end if;

  if new.payment_status is distinct from 'paid' then
    return new;
  end if;

  if coalesce(new.print_status,'pending')
     not in ('pending','manual_pending') then
    return new;
  end if;

  select * into cfg
  from public.configuracoes_impressao
  where organization_id=new.organization_id
  limit 1;

  if not found or coalesce(cfg.enabled,false) is not true then
    return new;
  end if;

  new.print_status:=case
    when coalesce(cfg.auto_print,false) then 'queued'
    else 'manual_pending'
  end;
  new.print_error:='';
  return new;
end
$$;

revoke all on function public.queue_order_for_printing()
  from public,anon,authenticated;

create or replace function public.print_agent_claim_jobs(
  _token text,
  _limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.configuracoes_impressao%rowtype;
  h text;
  rows jsonb;
begin
  if length(coalesce(_token,''))<32 then
    return jsonb_build_object('ok',false,'reason','invalid_token');
  end if;

  h:=encode(extensions.digest(_token,'sha256'),'hex');

  select * into cfg
  from public.configuracoes_impressao
  where agent_token_hash=h
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'reason','invalid_token');
  end if;

  if coalesce(cfg.enabled,false) is not true then
    return jsonb_build_object('ok',false,'reason','disabled');
  end if;

  update public.configuracoes_impressao
     set last_seen_at=now(),
         updated_at=now()
   where id=cfg.id;

  with claimed as (
    select id
    from public.orders
    where organization_id=cfg.organization_id
      and status in ('preparing','ready','out_for_delivery','delivered')
      and payment_status='paid'
      and (
        print_status in ('queued','pendente_impressao')
        or (
          print_status='printing'
          and print_claimed_at<now()-interval '3 minutes'
        )
      )
      and created_at>now()-interval '2 days'
    order by created_at
    limit greatest(1,least(coalesce(_limit,10),25))
    for update skip locked
  ),
  upd as (
    update public.orders o
       set print_status='printing',
           print_attempts=coalesce(o.print_attempts,0)+1,
           print_claimed_at=now(),
           updated_at=now()
      from claimed
     where o.id=claimed.id
     returning o.*
  )
  select coalesce(
    jsonb_agg(to_jsonb(upd.*) order by upd.created_at),
    '[]'::jsonb
  )
  into rows
  from upd;

  return jsonb_build_object(
    'ok',true,
    'organization_id',cfg.organization_id,
    'jobs',rows
  );
end
$$;

revoke all on function public.print_agent_claim_jobs(text,integer)
  from public,anon,authenticated;
grant execute on function public.print_agent_claim_jobs(text,integer)
  to anon,authenticated,service_role;

create or replace function public.print_agent_ack(
  _token text,
  _order_id uuid,
  _success boolean,
  _error text default ''
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.configuracoes_impressao%rowtype;
  o public.orders%rowtype;
  h text;
begin
  if length(coalesce(_token,''))<32 then
    return jsonb_build_object('ok',false,'reason','invalid_token');
  end if;

  h:=encode(extensions.digest(_token,'sha256'),'hex');

  select * into cfg
  from public.configuracoes_impressao
  where agent_token_hash=h
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'reason','invalid_token');
  end if;

  select * into o
  from public.orders
  where id=_order_id
    and organization_id=cfg.organization_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  update public.configuracoes_impressao
     set last_seen_at=now(),
         updated_at=now()
   where id=cfg.id;

  if o.status='cancelled' then
    update public.orders
       set print_status='cancelled',
           print_error='Pedido cancelado',
           print_claimed_at=null,
           updated_at=now()
     where id=o.id;

    insert into public.logs_impressao(
      organization_id,order_id,status,message,printer_ip
    )
    values(
      cfg.organization_id,o.id,'cancelled',
      'ACK ignorado: pedido cancelado',cfg.printer_ip
    );

    return jsonb_build_object('ok',false,'reason','order_cancelled');
  end if;

  if o.print_status<>'printing'
     or o.print_claimed_at is null then
    return jsonb_build_object('ok',false,'reason','job_not_claimed');
  end if;

  if _success then
    update public.orders
       set print_status='printed',
           printed_at=now(),
           print_error='',
           print_claimed_at=null,
           updated_at=now()
     where id=o.id;

    insert into public.logs_impressao(
      organization_id,order_id,status,message,printer_ip
    )
    values(
      cfg.organization_id,o.id,'printed',
      'Pedido impresso com sucesso',cfg.printer_ip
    );
  else
    update public.orders
       set print_status='pendente_impressao',
           print_error=left(coalesce(_error,''),500),
           print_claimed_at=null,
           updated_at=now()
     where id=o.id;

    insert into public.logs_impressao(
      organization_id,order_id,status,message,printer_ip
    )
    values(
      cfg.organization_id,o.id,'failure',
      left(coalesce(_error,'Falha de impressão'),500),
      cfg.printer_ip
    );
  end if;

  return jsonb_build_object('ok',true);
end
$$;

revoke all on function public.print_agent_ack(text,uuid,boolean,text)
  from public,anon,authenticated;
grant execute on function public.print_agent_ack(text,uuid,boolean,text)
  to anon,authenticated,service_role;
