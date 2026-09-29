create or replace function public.visionfood_push_delivery_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  phone text;
begin
  if new.status<>'out_for_delivery'
     or old.status is not distinct from new.status then
    return new;
  end if;

  phone:=regexp_replace(coalesce(new.customer_phone,''),'\D','','g');

  -- Discagem internacional 00 + 55 + DDD + número.
  if left(phone,4)='0055'
     and length(phone) in (14,15) then
    phone:=substring(phone from 3);
  end if;

  -- Prefixo nacional 0 + DDD + número.
  if left(phone,1)='0'
     and length(phone) in (11,12) then
    phone:=substring(phone from 2);
  end if;

  -- Prefixo de operadora 0XX + DDD + número.
  if left(phone,1)='0'
     and length(phone) in (13,14) then
    phone:=substring(phone from 4);
  end if;

  -- DDD + número sempre recebe o DDI 55, inclusive quando o DDD é 55.
  if length(phone) in (10,11) then
    phone:='55'||phone;
  end if;

  if length(phone)<8 then
    return new;
  end if;

  perform public.visionfood_onesignal_queue(
    jsonb_build_object(
      'include_aliases',
      jsonb_build_object('external_id',jsonb_build_array(phone))
    ),
    jsonb_build_object(
      'pt','🚀 Seu pedido saiu!'
    ),
    jsonb_build_object(
      'pt','O motoboy iniciou a entrega e seu pedido está a caminho.'
    ),
    jsonb_build_object(
      'event','out_for_delivery',
      'order_id',new.id,
      'organization_id',new.organization_id
    )
  );

  return new;
end
$$;

revoke all on function public.visionfood_push_delivery_trigger()
  from public,anon,authenticated;
