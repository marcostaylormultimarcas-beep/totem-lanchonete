create or replace function public.set_master_mp_token(_token text)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  sid uuid;
begin
  if u is null or not public.eh_super_admin(u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if nullif(btrim(coalesce(_token,'')),'') is null then return jsonb_build_object('ok',false,'reason','empty'); end if;

  insert into private.master_billing_secrets(id) values('global')
  on conflict(id) do nothing;

  select mp_master_token_secret_id into sid
  from private.master_billing_secrets where id='global' for update;

  if sid is not null and exists(select 1 from vault.secrets where id=sid) then
    perform vault.update_secret(sid,btrim(_token),null,null,null);
  else
    sid:=vault.create_secret(btrim(_token),'mp_master_token::global','Mercado Pago master token',null);
  end if;

  update private.master_billing_secrets
     set mp_master_token_secret_id=sid,updated_at=now()
   where id='global';

  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.set_master_mp_token(text) from public,anon;
grant execute on function public.set_master_mp_token(text) to authenticated;

create or replace function public.has_master_mp_token()
returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
     and public.eh_super_admin(auth.uid())
     and exists(
       select 1 from private.master_billing_secrets
       where id='global' and mp_master_token_secret_id is not null
     )
$$;
revoke all on function public.has_master_mp_token() from public,anon;
grant execute on function public.has_master_mp_token() to authenticated;

create or replace function public.get_master_mp_token_internal()
returns text
language sql stable security definer set search_path='' as $$
  select v.decrypted_secret
  from private.master_billing_secrets s
  join vault.decrypted_secrets v on v.id=s.mp_master_token_secret_id
  where s.id='global'
  limit 1
$$;
revoke all on function public.get_master_mp_token_internal() from public,anon,authenticated;
grant execute on function public.get_master_mp_token_internal() to service_role;

create or replace function public.set_valor_plano_padrao(_valor numeric)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null or not public.eh_super_admin(u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if _valor is null or _valor<=0 or _valor>1000000 then return jsonb_build_object('ok',false,'reason','invalid'); end if;
  insert into public.system_settings(id,valor_plano_padrao,updated_at)
  values('global',round(_valor,2),now())
  on conflict(id) do update set valor_plano_padrao=excluded.valor_plano_padrao,updated_at=now();
  return jsonb_build_object('ok',true,'valor',round(_valor,2));
end$$;
revoke all on function public.set_valor_plano_padrao(numeric) from public,anon;
grant execute on function public.set_valor_plano_padrao(numeric) to authenticated;

create or replace function public.set_system_whatsapp_suporte(_whatsapp text)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); digits text:=regexp_replace(coalesce(_whatsapp,''),'\D','','g');
begin
  if u is null or not public.eh_super_admin(u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if length(digits)<10 or length(digits)>15 then return jsonb_build_object('ok',false,'reason','invalid'); end if;
  insert into public.system_settings(id,whatsapp_suporte,updated_at)
  values('global',digits,now())
  on conflict(id) do update set whatsapp_suporte=excluded.whatsapp_suporte,updated_at=now();
  return jsonb_build_object('ok',true,'whatsapp_suporte',digits);
end$$;
revoke all on function public.set_system_whatsapp_suporte(text) from public,anon;
grant execute on function public.set_system_whatsapp_suporte(text) to authenticated;
