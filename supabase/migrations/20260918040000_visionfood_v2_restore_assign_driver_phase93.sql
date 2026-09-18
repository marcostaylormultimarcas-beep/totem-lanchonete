-- Phase 93: restore secure admin driver assignment RPC expected by OrdersPanel.
create or replace function public.assign_entregador(_order_id uuid,_entregador_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  o public.orders%rowtype;
  e public.entregadores%rowtype;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select * into o from public.orders where id=_order_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;
  if not public.usuario_dono_org(o.organization_id,u) and not public.eh_super_admin(u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  if _entregador_id is not null then
    select * into e from public.entregadores
      where id=_entregador_id and organization_id=o.organization_id
        and coalesce(active,true)=true and coalesce(ativo,true)=true;
    if not found then return jsonb_build_object('ok',false,'reason','entregador_invalid'); end if;
    if o.order_type not in ('delivery','viagem') then return jsonb_build_object('ok',false,'reason','not_delivery_order'); end if;
    if o.status in ('delivered','cancelled') then return jsonb_build_object('ok',false,'reason','status_locked'); end if;
  end if;
  update public.orders set entregador_id=_entregador_id,updated_at=now() where id=o.id;
  return jsonb_build_object('ok',true,'order_id',o.id,'entregador_id',_entregador_id);
end$$;
revoke all on function public.assign_entregador(uuid,uuid) from public,anon;
grant execute on function public.assign_entregador(uuid,uuid) to authenticated;
