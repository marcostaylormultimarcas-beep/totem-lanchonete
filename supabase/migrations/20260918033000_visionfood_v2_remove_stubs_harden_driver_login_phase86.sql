-- Phase 86: remove dead placeholder RPCs and harden the internal driver credential verifier.
drop function if exists public.get_customers(uuid);
drop function if exists public.get_operadores();
drop function if exists public.load_operadores();

create or replace function public.entregador_login(_org_slug text,_username text,_password text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_org public.organizations%rowtype;
  v_ent public.entregadores%rowtype;
  v_hash text;
begin
  select * into v_org
  from public.organizations
  where lower(slug)=lower(trim(_org_slug))
  limit 1;

  if v_org.id is null then
    return jsonb_build_object('ok',false,'reason','org_not_found');
  end if;

  select * into v_ent
  from public.entregadores
  where organization_id=v_org.id
    and lower(coalesce(username,usuario,''))=lower(trim(_username))
    and coalesce(active,ativo,true)=true
  limit 1;

  if v_ent.id is null then
    return jsonb_build_object('ok',false,'reason','invalid_credentials');
  end if;

  v_hash:=coalesce(v_ent.password,v_ent.senha);
  if v_hash is null or v_hash='' then
    return jsonb_build_object('ok',false,'reason','invalid_credentials');
  end if;

  if v_hash like '$2%' then
    if extensions.crypt(_password,v_hash)<>v_hash then
      return jsonb_build_object('ok',false,'reason','invalid_credentials');
    end if;
  else
    if _password<>v_hash then
      return jsonb_build_object('ok',false,'reason','invalid_credentials');
    end if;
    v_hash:=extensions.crypt(_password,extensions.gen_salt('bf',10));
    update public.entregadores
       set password=v_hash,senha=null,updated_at=now()
     where id=v_ent.id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'entregador',jsonb_build_object(
      'id',v_ent.id,
      'name',coalesce(v_ent.name,v_ent.nome,v_ent.username,v_ent.usuario),
      'username',coalesce(v_ent.username,v_ent.usuario),
      'organization_id',v_ent.organization_id,
      'org_slug',v_org.slug,
      'org_name',v_org.name
    )
  );
end$$;
revoke all on function public.entregador_login(text,text,text) from public,anon,authenticated;
