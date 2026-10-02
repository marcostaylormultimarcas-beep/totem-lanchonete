-- Phase 98: migrate loyalty from legacy pedidos to orders and expose safe customer state.
alter table public.pedidos_carimbados
  drop constraint if exists pedidos_carimbados_pedido_id_fkey;
alter table public.pedidos_carimbados
  add constraint pedidos_carimbados_pedido_id_fkey
  foreign key (pedido_id) references public.orders(id) on delete cascade;

alter table public.progresso_fidelidade
  drop constraint if exists progresso_fidelidade_ultimo_pedido_id_fkey;
alter table public.progresso_fidelidade
  add constraint progresso_fidelidade_ultimo_pedido_id_fkey
  foreign key (ultimo_pedido_id) references public.orders(id) on delete set null;

revoke all on table public.pedidos_carimbados from public,anon,authenticated;
revoke all on table public.progresso_fidelidade from public,anon,authenticated;
revoke all on table public.resgates_fidelidade from public,anon,authenticated;
grant select on table public.pedidos_carimbados to authenticated;
grant select on table public.progresso_fidelidade to authenticated;
grant select on table public.resgates_fidelidade to authenticated;
grant all on table public.pedidos_carimbados to service_role;
grant all on table public.progresso_fidelidade to service_role;
grant all on table public.resgates_fidelidade to service_role;

create or replace function public.grant_loyalty_stamp(_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
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
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select * into o from public.orders where id=_order_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;
  if not public.usuario_dono_org(o.organization_id,u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if o.status<>'delivered' then return jsonb_build_object('ok',false,'reason','order_not_delivered'); end if;
  if o.payment_status is distinct from 'paid' then return jsonb_build_object('ok',false,'reason','payment_not_confirmed'); end if;

  select * into cfg from public.config_fidelidade where organization_id=o.organization_id limit 1;
  if not found or coalesce(cfg.ativo,false) is not true then return jsonb_build_object('ok',false,'reason','inactive'); end if;
  if cfg.data_inicio is not null and current_date<cfg.data_inicio then return jsonb_build_object('ok',false,'reason','not_started'); end if;
  if cfg.data_fim is not null and current_date>cfg.data_fim then return jsonb_build_object('ok',false,'reason','expired'); end if;
  if o.total<coalesce(cfg.valor_minimo_pedido,0) then return jsonb_build_object('ok',false,'reason','below_minimum'); end if;

  phone:=regexp_replace(coalesce(o.customer_phone,''),'\D','','g');
  if length(phone)<8 then return jsonb_build_object('ok',false,'reason','no_phone'); end if;

  begin
    insert into public.pedidos_carimbados(pedido_id,organization_id,telefone_cliente)
    values(o.id,o.organization_id,phone);
  exception when unique_violation then
    return jsonb_build_object('ok',false,'reason','already_stamped');
  end;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(o.organization_id::text||':'||phone,0));

  select * into prog
  from public.progresso_fidelidade
  where organization_id=o.organization_id and telefone_cliente=phone
  for update;

  meta:=greatest(1,coalesce(cfg.meta_pedidos,10));
  prizes:=coalesce(prog.premios_resgatados,0);
  new_stamps:=coalesce(prog.quantidade_carimbos,0)+1;

  if new_stamps>=meta then
    new_stamps:=0;
    prizes:=prizes+1;
    code:='FID-'||upper(substring(replace(extensions.gen_random_uuid()::text,'-','') from 1 for 6));
    insert into public.resgates_fidelidade(organization_id,telefone_cliente,premio_texto,premio_imagem,codigo_resgate)
    values(o.organization_id,phone,coalesce(cfg.premio_recompensa,'Prêmio'),coalesce(cfg.premio_imagem,''),code)
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
      organization_id,telefone_cliente,quantidade_carimbos,premios_resgatados,ultimo_pedido_id
    )
    values(o.organization_id,phone,new_stamps,prizes,o.id);
  end if;

  return jsonb_build_object('ok',true,'carimbos',new_stamps,'meta',meta,'completed',reward_id is not null,'resgate_id',reward_id,'codigo',code);
end$$;
revoke all on function public.grant_loyalty_stamp(uuid) from public,anon;
grant execute on function public.grant_loyalty_stamp(uuid) to authenticated;

create or replace function public.redeem_loyalty_prize(_resgate_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.resgates_fidelidade%rowtype;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select * into r from public.resgates_fidelidade where id=_resgate_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if not public.usuario_dono_org(r.organization_id,u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if r.status<>'pendente' then return jsonb_build_object('ok',false,'reason','already_used'); end if;
  update public.resgates_fidelidade set status='utilizado',used_at=now(),used_by_user=u where id=r.id;
  return jsonb_build_object('ok',true,'id',r.id);
end$$;
revoke all on function public.redeem_loyalty_prize(uuid) from public,anon;
grant execute on function public.redeem_loyalty_prize(uuid) to authenticated;

create or replace function public.loyalty_customer_state(_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  phone text;
  cfg public.config_fidelidade%rowtype;
  stamps int:=0;
  rewards jsonb:='[]'::jsonb;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;

  select regexp_replace(coalesce(p.phone,''),'\D','','g')
    into phone
    from public.profiles p
   where p.user_id=u
   limit 1;

  if coalesce(length(phone),0)<8 then return jsonb_build_object('ok',false,'reason','no_phone'); end if;

  select * into cfg from public.config_fidelidade where organization_id=_organization_id limit 1;
  if not found then return jsonb_build_object('ok',true,'config',null,'stamps',0,'rewards','[]'::jsonb); end if;

  select coalesce(pf.quantidade_carimbos,0)
    into stamps
    from public.progresso_fidelidade pf
   where pf.organization_id=_organization_id
     and pf.telefone_cliente=phone
   limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',r.id,
      'premio_texto',r.premio_texto,
      'premio_imagem',r.premio_imagem,
      'codigo_resgate',r.codigo_resgate,
      'status',r.status,
      'created_at',r.created_at,
      'used_at',r.used_at
    ) order by r.created_at desc
  ),'[]'::jsonb)
  into rewards
  from (
    select * from public.resgates_fidelidade
    where organization_id=_organization_id and telefone_cliente=phone
    order by created_at desc
    limit 20
  ) r;

  return jsonb_build_object(
    'ok',true,
    'phone',phone,
    'config',jsonb_build_object(
      'ativo',coalesce(cfg.ativo,false),
      'meta_pedidos',coalesce(cfg.meta_pedidos,10),
      'valor_minimo_pedido',coalesce(cfg.valor_minimo_pedido,0),
      'premio_recompensa',coalesce(cfg.premio_recompensa,''),
      'descricao_premio',coalesce(cfg.descricao_premio,''),
      'premio_imagem',coalesce(cfg.premio_imagem,'')
    ),
    'stamps',coalesce(stamps,0),
    'rewards',rewards
  );
end$$;
revoke all on function public.loyalty_customer_state(uuid) from public,anon;
grant execute on function public.loyalty_customer_state(uuid) to authenticated;
