
alter table public.entregador_sessions
  alter column expires_at set default (now()+interval '12 hours');

create or replace function public.entregador_login_session(
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
  v_login jsonb;
  v_token text;
  v_driver_id uuid;
  v_org_id uuid;
  v_key text;
  v_attempt private.entregador_login_attempts%rowtype;
  v_next integer;
  v_expires_at timestamptz;
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
  from private.entregador_login_attempts
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

  v_login:=public.entregador_login(_org_slug,_username,_password);

  if coalesce((v_login->>'ok')::boolean,false) is not true then
    v_next:=case
      when found
       and coalesce(v_attempt.blocked_until,'-infinity'::timestamptz)<=now()
        then coalesce(v_attempt.attempts,0)+1
      else 1
    end;

    insert into private.entregador_login_attempts(
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

  delete from private.entregador_login_attempts
  where attempt_key=v_key;

  v_driver_id:=(v_login->'entregador'->>'id')::uuid;
  v_org_id:=(v_login->'entregador'->>'organization_id')::uuid;

  if not exists (
    select 1
    from public.entregadores e
    where e.id=v_driver_id
      and e.organization_id=v_org_id
      and coalesce(e.active,true)=true
      and coalesce(e.ativo,true)=true
  ) then
    return jsonb_build_object('ok',false,'reason','inactive_driver');
  end if;

  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_expires_at:=now()+interval '12 hours';

  insert into public.entregador_sessions(
    entregador_id,organization_id,token_hash,expires_at
  )
  values(
    v_driver_id,
    v_org_id,
    encode(extensions.digest(v_token,'sha256'),'hex'),
    v_expires_at
  );

  return v_login || jsonb_build_object(
    'session_token',v_token,
    'expires_at',v_expires_at,
    'expires_in_seconds',43200
  );
end
$$;

revoke all on function public.entregador_login_session(text,text,text)
  from public;
grant execute on function public.entregador_login_session(text,text,text)
  to anon,authenticated,service_role;
