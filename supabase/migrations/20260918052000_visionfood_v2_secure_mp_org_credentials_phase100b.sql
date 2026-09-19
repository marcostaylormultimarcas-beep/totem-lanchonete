create or replace function public.set_mp_credentials(
  _org uuid,_access_token text,_client_id text,_public_key text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  s private.organization_payment_secrets%rowtype;
  at_id uuid; ci_id uuid; pk_id uuid;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  if not public.usuario_dono_org(_org,u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if not exists(select 1 from public.organizations o where o.id=_org) then return jsonb_build_object('ok',false,'reason','org_not_found'); end if;

  insert into private.organization_payment_secrets(organization_id) values(_org)
  on conflict(organization_id) do nothing;

  select * into s from private.organization_payment_secrets where organization_id=_org for update;
  at_id:=s.mp_access_token_secret_id; ci_id:=s.mp_client_id_secret_id; pk_id:=s.mp_public_key_secret_id;

  if nullif(btrim(coalesce(_access_token,'')),'') is not null then
    if at_id is not null and exists(select 1 from vault.secrets where id=at_id) then
      perform vault.update_secret(at_id,btrim(_access_token),null,null,null);
    else
      at_id:=vault.create_secret(btrim(_access_token),'mp_access_token::'||_org::text,'Mercado Pago access token',null);
    end if;
  end if;

  if nullif(btrim(coalesce(_client_id,'')),'') is not null then
    if ci_id is not null and exists(select 1 from vault.secrets where id=ci_id) then
      perform vault.update_secret(ci_id,btrim(_client_id),null,null,null);
    else
      ci_id:=vault.create_secret(btrim(_client_id),'mp_client_id::'||_org::text,'Mercado Pago client id',null);
    end if;
  end if;

  if nullif(btrim(coalesce(_public_key,'')),'') is not null then
    if pk_id is not null and exists(select 1 from vault.secrets where id=pk_id) then
      perform vault.update_secret(pk_id,btrim(_public_key),null,null,null);
    else
      pk_id:=vault.create_secret(btrim(_public_key),'mp_public_key::'||_org::text,'Mercado Pago public key',null);
    end if;
  end if;

  update private.organization_payment_secrets
     set mp_access_token_secret_id=at_id,
         mp_client_id_secret_id=ci_id,
         mp_public_key_secret_id=pk_id,
         updated_at=now()
   where organization_id=_org;

  return jsonb_build_object('ok',true,'has_access_token',at_id is not null);
end$$;
revoke all on function public.set_mp_credentials(uuid,text,text,text) from public,anon;
grant execute on function public.set_mp_credentials(uuid,text,text,text) to authenticated;

create or replace function public.get_mp_credentials_for_owner(_org uuid)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  s private.organization_payment_secrets%rowtype;
  ci text; pk text;
begin
  if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  if not public.usuario_dono_org(_org,u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  select * into s from private.organization_payment_secrets where organization_id=_org;
  if not found then
    return jsonb_build_object('ok',true,'has_access_token',false,'access_token','','client_id','','public_key','');
  end if;

  if s.mp_client_id_secret_id is not null then
    select decrypted_secret into ci from vault.decrypted_secrets where id=s.mp_client_id_secret_id;
  end if;
  if s.mp_public_key_secret_id is not null then
    select decrypted_secret into pk from vault.decrypted_secrets where id=s.mp_public_key_secret_id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'has_access_token',s.mp_access_token_secret_id is not null,
    'access_token','',
    'client_id',coalesce(ci,''),
    'public_key',coalesce(pk,'')
  );
end$$;
revoke all on function public.get_mp_credentials_for_owner(uuid) from public,anon;
grant execute on function public.get_mp_credentials_for_owner(uuid) to authenticated;

create or replace function public.has_mp_access_token(_org uuid)
returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
     and exists(
       select 1
       from private.organization_payment_secrets s
       join public.organizations o on o.id=s.organization_id
       where s.organization_id=_org
         and s.mp_access_token_secret_id is not null
         and coalesce(o.ativo,true)=true
         and coalesce(o.bloqueado,false)=false
     )
$$;
revoke all on function public.has_mp_access_token(uuid) from public,anon;
grant execute on function public.has_mp_access_token(uuid) to authenticated;

create or replace function public.get_mp_access_token_internal(_org uuid)
returns text
language sql stable security definer set search_path='' as $$
  select v.decrypted_secret
  from private.organization_payment_secrets s
  join vault.decrypted_secrets v on v.id=s.mp_access_token_secret_id
  where s.organization_id=_org
  limit 1
$$;
revoke all on function public.get_mp_access_token_internal(uuid) from public,anon,authenticated;
grant execute on function public.get_mp_access_token_internal(uuid) to service_role;
