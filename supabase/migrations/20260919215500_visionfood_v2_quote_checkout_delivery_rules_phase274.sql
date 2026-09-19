-- VisionFood V2 PHASE 274
-- Keep quote_order_checkout_v2 intentionally callable by anon/authenticated for
-- public kiosk checkout, while closing server-side delivery/coupon rule gaps.
--
-- Confirmed issues:
-- 1) In delivery_mode='bairros', the authoritative quote did not enforce
--    settings.delivery_enabled. A client could still request a delivery quote
--    when delivery had been disabled in the admin panel.
-- 2) settings.delivery_pedido_minimo is configurable in the admin panel but was
--    not enforced by the authoritative quote path.
-- 3) The internal coupon quote uses COALESCE(data_fim, validade), which can
--    ignore an expired validade when data_fim is also populated. The v2 public
--    boundary now requires every configured expiry boundary to be valid.
--
-- Delivery opening hours are intentionally not enforced here: this RPC has no
-- scheduled_for parameter, so checking only now() would incorrectly reject
-- valid future scheduled orders. That requires a separate scheduled-order
-- contract instead of guessing at this boundary.

create or replace function public.quote_order_checkout_v2(
  _organization_id uuid,
  _order_type text default 'local',
  _bairro_id uuid default null,
  _delivery_fee numeric default 0,
  _items jsonb default '[]'::jsonb,
  _coupon_code text default '',
  _delivery_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  _mode text;
  _server_fee numeric := coalesce(_delivery_fee, 0);
  _delivery jsonb;
  _cep text;
  _item jsonb;
  _settings public.settings%rowtype;
  _quote jsonb;
  _coupon public.cupons%rowtype;
  _code text := upper(btrim(coalesce(_coupon_code, '')));
  _minimum numeric := 0;
begin
  if _items is null
     or jsonb_typeof(_items) <> 'array'
     or jsonb_array_length(_items) = 0
     or jsonb_array_length(_items) > 50 then
    raise exception 'items must contain between 1 and 50 rows';
  end if;

  if _delivery_context is null
     or jsonb_typeof(_delivery_context) <> 'object' then
    raise exception 'delivery_context must be an object';
  end if;

  if length(coalesce(_coupon_code, '')) > 100 then
    raise exception 'coupon_code exceeds maximum length';
  end if;

  for _item in
    select value
    from jsonb_array_elements(_items)
  loop
    if jsonb_typeof(_item) <> 'object' then
      raise exception 'invalid item';
    end if;

    if jsonb_typeof(coalesce(_item->'extras', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(_item->'extras', '[]'::jsonb)) > 30 then
      raise exception 'invalid extras list';
    end if;

    if jsonb_typeof(coalesce(_item->'removedIngredients', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(_item->'removedIngredients', '[]'::jsonb)) > 50 then
      raise exception 'invalid removed ingredients list';
    end if;
  end loop;

  if _order_type in ('viagem', 'delivery') then
    select *
      into _settings
    from public.settings s
    where s.organization_id = _organization_id
    limit 1;

    if not found or coalesce(_settings.delivery_enabled, true) is not true then
      raise exception 'delivery is disabled';
    end if;

    _mode := coalesce(_settings.delivery_mode, 'bairros');

    if _mode = 'lista_ceps' then
      _cep := regexp_replace(
        coalesce(_delivery_context->>'cep', ''),
        '[^0-9]',
        '',
        'g'
      );

      if length(_cep) <> 8 then
        raise exception 'delivery cep is required';
      end if;

      _delivery := public.validar_cep_entrega(
        _organization_id,
        _cep,
        null,
        null
      );

      if coalesce((_delivery->>'ok')::boolean, false) is not true then
        raise exception 'delivery area invalid: %',
          coalesce(_delivery->>'motivo', 'invalid');
      end if;

      _server_fee := greatest(
        coalesce((_delivery->>'taxa')::numeric, 0),
        0
      );
    elsif _mode = 'bairros' then
      -- The internal authoritative quote ignores the client fee and resolves
      -- the active bairro fee by organization_id + bairro_id.
      _server_fee := 0;
    else
      raise exception 'invalid delivery mode';
    end if;

    _minimum := greatest(
      coalesce(_settings.delivery_pedido_minimo, 0),
      0
    );
  end if;

  if _code <> '' then
    select *
      into _coupon
    from public.cupons c
    where c.organization_id = _organization_id
      and upper(c.codigo) = _code
    limit 1;

    if found then
      if _coupon.data_fim is not null
         and _coupon.data_fim < now() then
        raise exception 'coupon is outside validity period';
      end if;

      if _coupon.validade is not null
         and _coupon.validade < now() then
        raise exception 'coupon is outside validity period';
      end if;
    end if;
  end if;

  _quote := public.quote_order_checkout(
    _organization_id,
    _order_type,
    _bairro_id,
    _server_fee,
    _items,
    _coupon_code
  );

  if _order_type in ('viagem', 'delivery')
     and coalesce((_quote->>'subtotal')::numeric, 0) < _minimum then
    raise exception 'delivery minimum not reached';
  end if;

  return _quote;
end
$function$;

revoke execute on function public.quote_order_checkout_v2(
  uuid, text, uuid, numeric, jsonb, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.quote_order_checkout_v2(
  uuid, text, uuid, numeric, jsonb, text, jsonb
) to anon, authenticated, service_role;
