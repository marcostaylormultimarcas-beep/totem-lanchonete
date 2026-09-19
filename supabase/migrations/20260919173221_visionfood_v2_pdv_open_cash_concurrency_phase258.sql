-- PHASE 258: make PDV cash opening atomic per organization/operator.
-- The anon RPC surface remains intentional because authorization is carried
-- by the opaque PDV session token validated by pdv_session_context().

create unique index if not exists caixas_pdv_one_open_per_operator_uidx
  on public.caixas_pdv (organization_id, operador_id)
  where status in ('open', 'aberto');

create or replace function public.pdv_abrir_caixa_v2(
  _session_token text,
  _saldo_inicial numeric
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_ctx jsonb;
  v_op uuid;
  v_org uuid;
  v_name text;
  v_existing uuid;
  v_id uuid;
begin
  v_ctx := public.pdv_session_context(_session_token);

  if not coalesce((v_ctx->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  v_op := (v_ctx->>'operador_id')::uuid;
  v_org := (v_ctx->>'organization_id')::uuid;

  select id
    into v_existing
  from public.caixas_pdv
  where organization_id = v_org
    and operador_id = v_op
    and status in ('open', 'aberto')
  order by abertura_at desc
  limit 1;

  if v_existing is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'already_open',
      'caixa_id', v_existing
    );
  end if;

  select coalesce(name, nome, username, usuario, login, 'Operador')
    into v_name
  from public.operadores_pdv
  where id = v_op
    and organization_id = v_org;

  insert into public.caixas_pdv(
    organization_id,
    operador_id,
    status,
    saldo_inicial
  )
  values(
    v_org,
    v_op,
    'open',
    greatest(coalesce(_saldo_inicial, 0), 0)
  )
  on conflict (organization_id, operador_id)
    where status in ('open', 'aberto')
  do nothing
  returning id into v_id;

  if v_id is null then
    select id
      into v_existing
    from public.caixas_pdv
    where organization_id = v_org
      and operador_id = v_op
      and status in ('open', 'aberto')
    order by abertura_at desc
    limit 1;

    return jsonb_build_object(
      'ok', false,
      'reason', 'already_open',
      'caixa_id', v_existing
    );
  end if;

  insert into public.caixa_movimentos(
    caixa_id,
    organization_id,
    operador_id,
    operador_nome,
    tipo,
    forma_pagamento,
    valor,
    motivo
  )
  values(
    v_id,
    v_org,
    v_op,
    coalesce(v_name, 'Operador'),
    'abertura',
    'dinheiro',
    greatest(coalesce(_saldo_inicial, 0), 0),
    'Abertura de caixa'
  );

  return jsonb_build_object('ok', true, 'caixa_id', v_id);
end
$function$;
