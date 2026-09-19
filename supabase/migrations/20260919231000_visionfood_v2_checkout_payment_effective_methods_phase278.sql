-- VisionFood V2 PHASE 278
-- Keep visionfood_checkout_payment_config intentionally callable by anon/authenticated.
-- This RPC is the public checkout projection; private Mercado Pago credentials remain
-- behind private.organization_payment_secrets / Vault and service-role-only accessors.
--
-- Confirmed contract divergences:
-- - create_order_checkout_v2 accepts Pix only when pay_pix_enabled=true AND
--   pix_key_manual is nonblank, while this RPC previously returned the raw flag;
-- - the current checkout backend rejects payment_method='online' and the kiosk hides
--   online card unconditionally, while this RPC previously returned the raw
--   pay_card_online_enabled flag.
--
-- Keep the returned field set and ACL contract unchanged, but expose effective
-- checkout availability so public clients cannot be told that an unusable method
-- is enabled.

create or replace function public.visionfood_checkout_payment_config(_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  o public.organizations%rowtype;
  s public.settings%rowtype;
begin
  if _org is null then
    return jsonb_build_object('ok',false,'reason','invalid_organization');
  end if;

  select * into o
  from public.organizations
  where id=_org
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'reason','organization_not_found');
  end if;

  if coalesce(o.ativo,true) is not true
     or coalesce(o.bloqueado,false) is true
     or coalesce(o.status,'ativo')<>'ativo'
     or coalesce(o.status_assinatura,'ativo')<>'ativo' then
    return jsonb_build_object('ok',false,'reason','organization_unavailable');
  end if;

  select * into s
  from public.settings
  where organization_id=_org
  limit 1;

  return jsonb_build_object(
    'ok',true,
    'store_name',coalesce(nullif(btrim(s.store_name),''),nullif(btrim(o.name),''),'VisionFood'),
    'whatsapp_number',coalesce(s.whatsapp_number,''),
    'pix_key_manual',coalesce(nullif(btrim(s.pix_key_manual),''),''),
    'pay_cash_enabled',coalesce(s.pay_cash_enabled,true),
    'pay_pix_enabled',
      coalesce(s.pay_pix_enabled,true)
      and nullif(btrim(coalesce(s.pix_key_manual,'')),'') is not null,
    'pay_card_terminal_enabled',coalesce(s.pay_card_terminal_enabled,false),
    'pay_card_online_enabled',false,
    'mp_terminal_id',coalesce(s.mp_terminal_id,''),
    'automatic_pix_supported',false
  );
end
$function$;
