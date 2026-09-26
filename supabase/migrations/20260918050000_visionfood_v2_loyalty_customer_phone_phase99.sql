-- Phase 99: loyalty customer state resolves phone from the customer's own latest order, then profile.
create or replace function public.loyalty_customer_state(_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  phone text;
  cfg public.config_fidelidade%rowtype;
  stamps int:=0;
  rewards jsonb:='[]'::jsonb;
  cfg_json jsonb;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;

  select * into cfg
  from public.config_fidelidade
  where organization_id=_organization_id
  limit 1;

  if not found then
    return jsonb_build_object('ok',true,'config',null,'phone','','stamps',0,'rewards','[]'::jsonb);
  end if;

  cfg_json:=jsonb_build_object(
    'ativo',coalesce(cfg.ativo,false),
    'meta_pedidos',coalesce(cfg.meta_pedidos,10),
    'valor_minimo_pedido',coalesce(cfg.valor_minimo_pedido,0),
    'premio_recompensa',coalesce(cfg.premio_recompensa,''),
    'descricao_premio',coalesce(cfg.descricao_premio,''),
    'premio_imagem',coalesce(cfg.premio_imagem,'')
  );

  select regexp_replace(coalesce(o.customer_phone,''),'\D','','g')
    into phone
    from public.orders o
   where o.organization_id=_organization_id
     and o.user_id=u
     and length(regexp_replace(coalesce(o.customer_phone,''),'\D','','g'))>=8
   order by o.created_at desc
   limit 1;

  if coalesce(length(phone),0)<8 then
    select regexp_replace(coalesce(p.phone,''),'\D','','g')
      into phone
      from public.profiles p
     where p.user_id=u
     limit 1;
  end if;

  if coalesce(length(phone),0)<8 then
    return jsonb_build_object(
      'ok',true,'reason','no_phone','config',cfg_json,'phone','','stamps',0,'rewards','[]'::jsonb
    );
  end if;

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
    where organization_id=_organization_id
      and telefone_cliente=phone
    order by created_at desc
    limit 20
  ) r;

  return jsonb_build_object(
    'ok',true,
    'phone',phone,
    'config',cfg_json,
    'stamps',coalesce(stamps,0),
    'rewards',rewards
  );
end$$;
revoke all on function public.loyalty_customer_state(uuid) from public,anon;
grant execute on function public.loyalty_customer_state(uuid) to authenticated;
