-- VisionFood V2 PHASE 268
-- Harden server-side validation for privileged PDV cash movements.
-- The client only submits sangria/suprimento in dinheiro and requires a reason,
-- but this SECURITY DEFINER RPC is directly reachable by anon with a valid
-- opaque PDV session token, so the same invariants must be enforced here.

create or replace function public.pdv_registrar_movimento_v2(
  _session_token text,
  _caixa_id uuid,
  _tipo text,
  _forma text,
  _valor numeric,
  _motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx jsonb;
  v_op uuid;
  v_org uuid;
  v_name text;
  v_forma text;
  v_motivo text;
begin
  v_ctx := public.pdv_session_context(_session_token);

  if not coalesce((v_ctx->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  v_op := (v_ctx->>'operador_id')::uuid;
  v_org := (v_ctx->>'organization_id')::uuid;

  if coalesce(_tipo, '') not in ('sangria', 'suprimento')
     or coalesce(_valor, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_movement');
  end if;

  v_forma := lower(btrim(coalesce(_forma, '')));
  if v_forma = '' then
    v_forma := 'dinheiro';
  end if;

  v_motivo := btrim(coalesce(_motivo, ''));

  if v_forma <> 'dinheiro' or length(v_motivo) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_movement');
  end if;

  if not exists (
    select 1
    from public.caixas_pdv
    where id = _caixa_id
      and organization_id = v_org
      and operador_id = v_op
      and status = 'open'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_cash');
  end if;

  select coalesce(name, nome, username, usuario, login, 'Operador')
    into v_name
  from public.operadores_pdv
  where id = v_op
    and organization_id = v_org;

  insert into public.caixa_movimentos (
    caixa_id,
    organization_id,
    operador_id,
    operador_nome,
    tipo,
    forma_pagamento,
    valor,
    motivo
  )
  values (
    _caixa_id,
    v_org,
    v_op,
    coalesce(v_name, 'Operador'),
    _tipo,
    v_forma,
    _valor,
    left(v_motivo, 500)
  );

  return jsonb_build_object('ok', true);
end
$function$;
