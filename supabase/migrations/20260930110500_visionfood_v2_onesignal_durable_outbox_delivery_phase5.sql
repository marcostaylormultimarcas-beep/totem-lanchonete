-- OneSignal Durable Outbox V2 - phase 5.
--
-- Cut over only delivery pushes to the durable outbox. Rupture remains on the
-- legacy queue in this phase. The order/status trigger contract and customer
-- audience/payload stay unchanged; retries reuse the frozen durable request.

create or replace function public.visionfood_push_delivery_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  phone text;
  delivery_idempotency_key uuid;
  delivery_outbox_id uuid;
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

  delivery_idempotency_key:=gen_random_uuid();

  begin
    delivery_outbox_id:=private.visionfood_onesignal_outbox_enqueue(
      new.organization_id,
      'delivery',
      'order_status',
      new.id::text||':out_for_delivery',
      jsonb_build_object(
        'include_aliases',
        jsonb_build_object(
          'external_id',
          jsonb_build_array(phone)
        )
      ),
      jsonb_build_object(
        'headings',
        jsonb_build_object(
          'pt','🚀 Seu pedido saiu!'
        ),
        'contents',
        jsonb_build_object(
          'pt','O motoboy iniciou a entrega e seu pedido está a caminho.'
        ),
        'data',
        jsonb_build_object(
          'event','out_for_delivery',
          'order_id',new.id,
          'organization_id',new.organization_id
        )
      ),
      delivery_idempotency_key
    );
  exception
    when others then
      -- Preserve the legacy trigger contract: missing OneSignal configuration
      -- must never block the order status transition.
      if sqlstate='55000'
         and sqlerrm='onesignal_outbox_not_configured' then
        return new;
      end if;
      raise;
  end;

  -- Submit only this delivery row. pg_net is transport metadata; the durable
  -- outbox row remains the source of truth and retains the same idempotency key
  -- and frozen payload/audience across retries.
  perform private.visionfood_onesignal_outbox_dispatch_one(
    delivery_outbox_id,
    'delivery-trigger',
    30,
    15,
    8
  );

  return new;
end
$$;

revoke all on function public.visionfood_push_delivery_trigger()
  from public,anon,authenticated;
