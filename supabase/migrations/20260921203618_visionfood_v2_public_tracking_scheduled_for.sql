-- Expose scheduled_for in the public order-tracking contract so scheduled
-- orders can be presented truthfully on mobile and through kiosk QR tracking.
CREATE OR REPLACE FUNCTION public.visionfood_public_order_tracking(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  o record;
begin
  if _order_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_order');
  end if;

  select
    ord.id,
    ord.order_number,
    ord.status,
    ord.order_type,
    ord.scheduled_for,
    ord.updated_at
  into o
  from public.orders ord
  join public.organizations org
    on org.id=ord.organization_id
  where ord.id=_order_id
    and ord.created_at>now()-interval '30 days'
    and coalesce(org.ativo,true)=true
    and coalesce(org.bloqueado,false)=false
    and coalesce(org.status,'ativo')='ativo'
    and coalesce(org.status_assinatura,'ativo')='ativo'
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'reason','not_found');
  end if;

  return jsonb_build_object(
    'ok',true,
    'order_id',o.id,
    'order_number',o.order_number,
    'status',o.status,
    'order_type',o.order_type,
    'scheduled_for',o.scheduled_for,
    'updated_at',o.updated_at
  );
end
$function$;
