-- VisionFood V2 PHASE 273
-- Keep pdv_validar_cupom_v2 intentionally callable by anon/authenticated with
-- an opaque PDV session token, while aligning its coupon contract with the
-- authoritative sale/PIX paths.
--
-- Confirmed issues:
-- 1) COALESCE(data_fim, validade) could accept a coupon when one of the two
--    configured expiry limits had already elapsed.
-- 2) The RPC returned raw discount types such as "porcentagem", while the PDV
--    preview historically treated only "percentual"/"percent" as percentage.
--    The RPC now returns a canonical discount type and a bounded value.

create or replace function public.pdv_validar_cupom_v2(
  _session_token text,
  _codigo text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  s public.pdv_sessions%rowtype;
  h text;
  c public.cupons%rowtype;
  code text;
  typ text;
  normalized_value numeric;
begin
  h := encode(
    extensions.digest(coalesce(_session_token, ''), 'sha256'),
    'hex'
  );

  select *
    into s
  from public.pdv_sessions
  where token_hash = h
    and revoked_at is null
    and expires_at > now();

  if s.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  code := upper(btrim(coalesce(_codigo, '')));

  if code = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  select *
    into c
  from public.cupons
  where organization_id = s.organization_id
    and upper(codigo) = code
  limit 1;

  if c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(c.ativo, true) = false
     or coalesce(c.status, true) = false then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  if c.data_inicio is not null and c.data_inicio > now() then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;

  if c.data_fim is not null and c.data_fim < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if c.validade is not null and c.validade < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  typ := lower(coalesce(nullif(c.tipo, ''), c.tipo_desconto, ''));

  if typ in ('percentual', 'porcentagem', 'percent', 'percentage') then
    typ := 'percent';
    normalized_value := greatest(0, least(coalesce(c.valor, 0), 100));
  elsif typ in ('valor_fixo', 'fixed', 'fixo') then
    typ := 'fixed';
    normalized_value := greatest(0, coalesce(c.valor, 0));
  else
    return jsonb_build_object(
      'ok', false,
      'reason', 'invalid_discount_type'
    );
  end if;

  update public.pdv_sessions
     set last_seen_at = now()
   where id = s.id;

  return jsonb_build_object(
    'ok', true,
    'cupom', jsonb_build_object(
      'codigo', c.codigo,
      'tipo', typ,
      'valor', normalized_value,
      'minimo_pedido', greatest(0, coalesce(c.minimo_pedido, 0))
    )
  );
end
$function$;

revoke execute on function public.pdv_validar_cupom_v2(text, text)
from public, anon, authenticated, service_role;

grant execute on function public.pdv_validar_cupom_v2(text, text)
to anon, authenticated, service_role;
