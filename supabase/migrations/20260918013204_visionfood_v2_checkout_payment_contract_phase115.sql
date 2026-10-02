
alter table public.settings
  add column if not exists pix_key_manual text not null default '',
  add column if not exists pay_cash_enabled boolean not null default true,
  add column if not exists pay_pix_enabled boolean not null default true,
  add column if not exists pay_card_terminal_enabled boolean not null default false,
  add column if not exists pay_card_online_enabled boolean not null default false,
  add column if not exists mp_terminal_id text not null default '';

update public.settings
   set pix_key_manual = btrim(coalesce(pix_chave,''))
 where nullif(btrim(coalesce(pix_key_manual,'')),'') is null
   and nullif(btrim(coalesce(pix_chave,'')),'') is not null;

create or replace function public.visionfood_checkout_payment_config(_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
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
     or coalesce(o.bloqueado,false) is true then
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
    'pix_key_manual',coalesce(s.pix_key_manual,''),
    'pay_cash_enabled',coalesce(s.pay_cash_enabled,true),
    'pay_pix_enabled',coalesce(s.pay_pix_enabled,true),
    'pay_card_terminal_enabled',coalesce(s.pay_card_terminal_enabled,false),
    'pay_card_online_enabled',coalesce(s.pay_card_online_enabled,false),
    'mp_terminal_id',coalesce(s.mp_terminal_id,''),
    'automatic_pix_supported',false
  );
end
$$;

revoke all on function public.visionfood_checkout_payment_config(uuid)
  from public;
grant execute on function public.visionfood_checkout_payment_config(uuid)
  to anon,authenticated,service_role;
