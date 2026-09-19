create or replace function public.set_valor_plano_padrao(_valor numeric)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  u uuid := auth.uid();
begin
  if u is null or not private.eh_super_admin(u) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if _valor is null or _valor < 1 or _valor > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  insert into public.system_settings(id, valor_plano_padrao, updated_at)
  values('global', round(_valor, 2), now())
  on conflict(id) do update
    set valor_plano_padrao = excluded.valor_plano_padrao,
        updated_at = now();

  return jsonb_build_object('ok', true, 'valor', round(_valor, 2));
end
$function$;

revoke all on function public.set_valor_plano_padrao(numeric) from public, anon;
grant execute on function public.set_valor_plano_padrao(numeric) to authenticated, service_role;
