create or replace function public.pdv_resume_session_v2(_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx jsonb;
  v_caixa uuid;
begin
  v_ctx := public.pdv_session_context(_session_token);

  if not coalesce((v_ctx->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  select c.id
    into v_caixa
  from public.caixas_pdv c
  where c.organization_id = (v_ctx->>'organization_id')::uuid
    and c.operador_id = (v_ctx->>'operador_id')::uuid
    and c.status in ('open', 'aberto')
  order by c.abertura_at desc
  limit 1;

  return v_ctx || jsonb_build_object('caixa_aberto_id', v_caixa);
end
$function$;

create or replace function public.pdv_logout_v2(_session_token text)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select public.pdv_revoke_session(_session_token)
$function$;

revoke all on function public.pdv_resume_session_v2(text) from public;
revoke all on function public.pdv_logout_v2(text) from public;
revoke all on function public.pdv_resume_session_v2(text) from anon, authenticated;
revoke all on function public.pdv_logout_v2(text) from anon, authenticated;

grant execute on function public.pdv_resume_session_v2(text) to anon, authenticated, service_role;
grant execute on function public.pdv_logout_v2(text) to anon, authenticated, service_role;
