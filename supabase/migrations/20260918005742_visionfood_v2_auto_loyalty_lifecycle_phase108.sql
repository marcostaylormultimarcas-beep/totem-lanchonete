
create or replace function public.visionfood_apply_loyalty_for_order(
  _order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  o public.orders%rowtype;
  cfg public.config_fidelidade%rowtype;
  prog public.progresso_fidelidade%rowtype;
  phone text;
  meta int;
  new_stamps int;
  prizes int;
  reward_id uuid;
  code text;
begin
  select * into o
  from public.orders
  where id=_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','order_not_found');
  end if;

  if o.status<>'delivered' then
    return jsonb_build_object('ok',false,'reason','order_not_delivered');
  end if;

  if o.payment_status is distinct from 'paid' then
    return jsonb_build_object('ok',false,'reason','payment_not_confirmed');
  end if;

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

  if o.total<coalesce(cfg.valor_minimo_pedido,0) then
    return jsonb_build_object('ok',false,'reason','below_minimum');
  end if;

  phone:=regexp_replace(coalesce(o.customer_phone,''),'\D','','g');
  if length(phone)<8 then
    return jsonb_build_object('ok',false,'reason','no_phone');
  end if;

  begin
    insert into public.pedidos_carimbados(
      pedido_id,organization_id,telefone_cliente
    )
    values(o.id,o.organization_id,phone);
  exception when unique_violation then
    return jsonb_build_object(
      'ok',true,
      'already_stamped',true,
      'awarded',false
    );
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(o.organization_id::text||':'||phone,0)
  );

  select * into prog
  from public.progresso_fidelidade
  where organization_id=o.organization_id
    and telefone_cliente=phone
  for update;

  meta:=greatest(1,coalesce(cfg.meta_pedidos,10));
  prizes:=coalesce(prog.premios_resgatados,0);
  new_stamps:=coalesce(prog.quantidade_carimbos,0)+1;

  if new_stamps>=meta then
    new_stamps:=0;
    prizes:=prizes+1;
    code:='FID-'||
      upper(substring(
        replace(extensions.gen_random_uuid()::text,'-','')
        from 1 for 6
      ));

    insert into public.resgates_fidelidade(
      organization_id,telefone_cliente,premio_texto,
      premio_imagem,codigo_resgate
    )
    values(
      o.organization_id,phone,
      coalesce(cfg.premio_recompensa,'Prêmio'),
      coalesce(cfg.premio_imagem,''),
      code
    )
    returning id into reward_id;
  end if;

  if prog.id is not null then
    update public.progresso_fidelidade
       set quantidade_carimbos=new_stamps,
           premios_resgatados=prizes,
           ultimo_pedido_id=o.id,
           updated_at=now()
     where id=prog.id;
  else
    insert into public.progresso_fidelidade(
      organization_id,telefone_cliente,quantidade_carimbos,
      premios_resgatados,ultimo_pedido_id
    )
    values(
      o.organization_id,phone,new_stamps,prizes,o.id
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'awarded',true,
    'carimbos',new_stamps,
    'meta',meta,
    'completed',reward_id is not null,
    'resgate_id',reward_id,
    'codigo',code
  );
end
$$;

revoke all on function public.visionfood_apply_loyalty_for_order(uuid)
  from public,anon,authenticated;

create or replace function public.grant_loyalty_stamp(
  _order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  o public.orders%rowtype;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  select * into o
  from public.orders
  where id=_order_id;

  if not found then
    return jsonb_build_object('ok',false,'reason','order_not_found');
  end if;

  if not public.usuario_dono_org(o.organization_id,u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  return public.visionfood_apply_loyalty_for_order(_order_id);
end
$$;

revoke all on function public.grant_loyalty_stamp(uuid)
  from public,anon;
grant execute on function public.grant_loyalty_stamp(uuid)
  to authenticated;

create or replace function public.visionfood_auto_loyalty_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  begin
    perform public.visionfood_apply_loyalty_for_order(new.id);
  exception when others then
    raise warning 'visionfood_auto_loyalty_failed order=% sqlstate=%',
      new.id,sqlstate;
  end;

  return new;
end
$$;

revoke all on function public.visionfood_auto_loyalty_trigger()
  from public,anon,authenticated;

drop trigger if exists trg_visionfood_auto_loyalty
  on public.orders;

create trigger trg_visionfood_auto_loyalty
after update of status,payment_status on public.orders
for each row
when (
  new.status='delivered'
  and new.payment_status='paid'
  and (
    old.status is distinct from new.status
    or old.payment_status is distinct from new.payment_status
  )
)
execute function public.visionfood_auto_loyalty_trigger();
