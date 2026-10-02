-- Phase 207: align public coupon validation with the authoritative checkout contract.
-- This RPC remains intentionally callable by anon/authenticated for kiosk checkout.
-- Only the accepted coupon discount-type contract and exact EXECUTE ACL are changed.

create or replace function public.validate_checkout_coupon(
  _organization_id uuid,
  _codigo text,
  _subtotal numeric default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  c public.cupons%rowtype;
  code text:=upper(btrim(coalesce(_codigo,'')));
  st numeric:=greatest(0,coalesce(_subtotal,0));
  typ text;
  disc numeric;
begin
  if _organization_id is null or code='' then
    return jsonb_build_object('ok',false,'reason','invalid_code');
  end if;

  if coalesce(
    (public.visionfood_public_organization(_organization_id,null)->>'paused')::boolean,
    true
  ) then
    return jsonb_build_object('ok',false,'reason','invalid_organization');
  end if;

  perform public.visionfood_coupon_rate_limit_check(_organization_id);

  select *
  into c
  from public.cupons
  where organization_id=_organization_id
    and upper(codigo)=code
  limit 1;

  if c.id is null then
    return jsonb_build_object('ok',false,'reason','not_found');
  end if;
  if coalesce(c.ativo,true)=false or coalesce(c.status,true)=false then
    return jsonb_build_object('ok',false,'reason','inactive');
  end if;
  if c.data_inicio is not null and c.data_inicio>now() then
    return jsonb_build_object('ok',false,'reason','not_started');
  end if;
  if c.data_fim is not null and c.data_fim<now() then
    return jsonb_build_object('ok',false,'reason','expired');
  end if;
  if c.validade is not null and c.validade<now() then
    return jsonb_build_object('ok',false,'reason','expired');
  end if;
  if st<coalesce(c.minimo_pedido,0) then
    return jsonb_build_object(
      'ok',false,
      'reason','minimum_not_met',
      'minimo_pedido',coalesce(c.minimo_pedido,0)
    );
  end if;

  typ:=lower(coalesce(nullif(c.tipo,''),c.tipo_desconto,''));
  if typ in ('porcentagem','percent','percentage') then
    disc:=round(
      st*greatest(0,least(coalesce(c.valor,0),100))/100,
      2
    );
  elsif typ in ('valor_fixo','fixed','fixo') then
    disc:=least(st,greatest(0,coalesce(c.valor,0)));
  else
    return jsonb_build_object('ok',false,'reason','invalid_discount_type');
  end if;

  return jsonb_build_object(
    'ok',true,
    'cupom',jsonb_build_object(
      'id',c.id,
      'codigo',c.codigo,
      'tipo',typ,
      'valor',c.valor,
      'minimo_pedido',coalesce(c.minimo_pedido,0),
      'discount',disc
    )
  );
end
$function$;

revoke execute on function public.validate_checkout_coupon(uuid,text,numeric)
from public, anon, authenticated, service_role;

grant execute on function public.validate_checkout_coupon(uuid,text,numeric)
to anon, authenticated, service_role;
