
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

  if not (
    private.usuario_dono_org(o.organization_id,u)
    or private.eh_super_admin(u)
  ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  return public.visionfood_apply_loyalty_for_order(_order_id);
end
$function$;

revoke all on function public.grant_loyalty_stamp(uuid) from public,anon;
grant execute on function public.grant_loyalty_stamp(uuid) to authenticated;
