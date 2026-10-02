
create or replace function public.visionfood_order_receipt(_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  o public.orders%rowtype;
  org public.organizations%rowtype;
  s public.settings%rowtype;
begin
  if u is null then
    return jsonb_build_object('ok',false,'reason','unauthenticated');
  end if;

  if _order_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_order');
  end if;

  select * into o
  from public.orders
  where id=_order_id
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'reason','not_found');
  end if;

  if o.user_id is distinct from u
     and not public.usuario_dono_org(o.organization_id,u)
     and not public.eh_super_admin(u) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  select * into org
  from public.organizations
  where id=o.organization_id
  limit 1;

  select * into s
  from public.settings
  where organization_id=o.organization_id
  limit 1;

  return jsonb_build_object(
    'ok',true,
    'order',jsonb_build_object(
      'id',o.id,
      'order_number',o.order_number,
      'created_at',o.created_at,
      'customer_name',o.customer_name,
      'customer_cpf',coalesce(o.customer_cpf,''),
      'total',o.total,
      'items',coalesce(o.items,'[]'::jsonb),
      'payment_method',coalesce(o.payment_method,''),
      'organization_id',o.organization_id
    ),
    'store',jsonb_build_object(
      'store_name',coalesce(nullif(btrim(s.store_name),''),nullif(btrim(org.name),''),'LOJA'),
      'fiscal_cnpj',coalesce(org.cnpj,''),
      'fiscal_razao',coalesce(org.razao_social,'')
    )
  );
end
$$;

revoke all on function public.visionfood_order_receipt(uuid)
  from public,anon;
grant execute on function public.visionfood_order_receipt(uuid)
  to authenticated,service_role;
