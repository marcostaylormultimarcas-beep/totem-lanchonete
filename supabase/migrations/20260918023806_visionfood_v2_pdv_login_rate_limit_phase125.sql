
create table if not exists private.pdv_login_attempts (
  attempt_key text primary key,
  attempts integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

revoke all on table private.pdv_login_attempts
  from public,anon,authenticated;
grant select,insert,update,delete
  on table private.pdv_login_attempts
  to service_role;

create or replace function public.pdv_create_session(
  _org_slug text,
  _username text,
  _password text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org public.organizations%rowtype;
  v_op public.operadores_pdv%rowtype;
  v_cred text;
  v_token text;
  v_hash text;
  v_caixa uuid;
  v_key text;
  v_attempt private.pdv_login_attempts%rowtype;
  v_next integer;
begin
  if nullif(btrim(coalesce(_org_slug,'')),'') is null
     or nullif(btrim(coalesce(_username,'')),'') is null
     or _password is null
     or length(_org_slug)>120
     or length(_username)>120
     or length(_password)>200 then
    return jsonb_build_object('ok',false,'reason','invalid_credentials');
  end if;

  v_key:=encode(
    extensions.digest(
      lower(btrim(_org_slug)) || E'\n' || lower(btrim(_username)),
      'sha256'
    ),
    'hex'
  );

  select * into v_attempt
  from private.pdv_login_attempts
  where attempt_key=v_key
  for update;

  if found
     and v_attempt.blocked_until is not null
     and v_attempt.blocked_until>now() then
    return jsonb_build_object(
      'ok',false,
      'reason','too_many_attempts',
      'retry_after_seconds',
      greatest(
        1,
        ceil(extract(epoch from (v_attempt.blocked_until-now())))::integer
      )
    );
  end if;

  select * into v_org
  from public.organizations
  where lower(slug)=lower(btrim(_org_slug))
  limit 1;

  if v_org.id is not null then
    select * into v_op
    from public.operadores_pdv o
    where o.organization_id=v_org.id
      and lower(btrim(coalesce(o.usuario,o.login,o.username,o.nome,'')))=lower(btrim(_username))
      and coalesce(o.ativo,o.active,true)=true
    limit 1;
  end if;

  v_cred:=coalesce(v_op.senha,v_op.password,v_op.pin);

  if v_org.id is null
     or v_op.id is null
     or v_cred is null
     or v_cred not like '$2%'
     or extensions.crypt(_password,v_cred)<>v_cred then

    v_next:=case
      when found
       and coalesce(v_attempt.blocked_until,'-infinity'::timestamptz)<=now()
        then coalesce(v_attempt.attempts,0)+1
      else 1
    end;

    insert into private.pdv_login_attempts(
      attempt_key,attempts,blocked_until,updated_at
    )
    values(
      v_key,
      v_next,
      case when v_next>=5 then now()+interval '10 minutes' else null end,
      now()
    )
    on conflict(attempt_key) do update
      set attempts=excluded.attempts,
          blocked_until=excluded.blocked_until,
          updated_at=now();

    if v_next>=5 then
      return jsonb_build_object(
        'ok',false,
        'reason','too_many_attempts',
        'retry_after_seconds',600
      );
    end if;

    return jsonb_build_object(
      'ok',false,
      'reason','invalid_credentials',
      'remaining_attempts',5-v_next
    );
  end if;

  delete from private.pdv_login_attempts
  where attempt_key=v_key;

  if coalesce(v_org.ativo,true) is not true
     or coalesce(v_org.bloqueado,false) is true
     or coalesce(v_org.status,'ativo')<>'ativo'
     or coalesce(v_org.status_assinatura,'ativo')<>'ativo' then
    return jsonb_build_object('ok',false,'reason','organization_unavailable');
  end if;

  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_hash:=encode(extensions.digest(v_token,'sha256'),'hex');

  insert into public.pdv_sessions(
    token_hash,operador_id,organization_id,store_id
  )
  values(
    v_hash,v_op.id,v_op.organization_id,v_op.store_id
  );

  select id into v_caixa
  from public.caixas_pdv
  where operador_id=v_op.id
    and organization_id=v_op.organization_id
    and status in ('open','aberto')
  order by abertura_at desc
  limit 1;

  return jsonb_build_object(
    'ok',true,
    'session_token',v_token,
    'expires_in_seconds',43200,
    'operador',jsonb_build_object(
      'id',v_op.id,
      'name',coalesce(v_op.name,v_op.nome,v_op.username),
      'username',coalesce(v_op.username,v_op.usuario,v_op.login),
      'organization_id',v_op.organization_id,
      'org_slug',v_org.slug,
      'org_name',v_org.name,
      'store_id',v_op.store_id,
      'role',v_op.role
    ),
    'caixa_aberto_id',v_caixa
  );
end
$$;

revoke all on function public.pdv_create_session(text,text,text)
  from public;
grant execute on function public.pdv_create_session(text,text,text)
  to anon,authenticated,service_role;
