-- VisionFood V2: immediate direct-stock availability and safe administrative stock mutation.
-- Additive migration only. Historical migrations and historical stock ledgers remain untouched.
--
-- Contract:
-- - public/PDV catalogs keep evaluating manage_stock + stock_quantity dynamically;
-- - products.available remains independent manual/recipe availability state;
-- - exact direct-stock requests are checked using weight_kg for weighted products
--   and quantity for unit products, with duplicate cart lines aggregated;
-- - quote/PIX preflight reject impossible direct-stock requests early;
-- - the order INSERT trigger remains the final atomic stock authority under row locks;
-- - future stock_quantity writes cannot introduce negative direct stock.

create or replace function public.visionfood_direct_stock_request_fits(
  _organization_id uuid,
  _items jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if _organization_id is null
     or _items is null
     or jsonb_typeof(_items)<>'array'
     or jsonb_array_length(_items)=0 then
    return false;
  end if;

  return not exists (
    with parsed_items as (
      select
        nullif(item_value->>'product_id','')::uuid as product_id,
        coalesce(nullif(item_value->>'quantity','')::numeric,1) as quantity,
        nullif(item_value->>'weight_kg','')::numeric as weight_kg
      from jsonb_array_elements(_items) as item_rows(item_value)
    ),
    managed_lines as (
      select
        p.id as product_id,
        case
          when coalesce(p.sold_by_weight,false) then i.weight_kg
          else i.quantity
        end as amount
      from parsed_items i
      join public.products p
        on p.id=i.product_id
       and p.organization_id=_organization_id
      where coalesce(p.manage_stock,false) is true
    ),
    requested as (
      select
        i.product_id,
        sum(i.amount) as amount
      from managed_lines i
      group by i.product_id
    )
    select 1
    from requested r
    join public.products p
      on p.id=r.product_id
     and p.organization_id=_organization_id
    where r.amount is null
       or r.amount<=0
       or coalesce(p.stock_quantity,0)<r.amount
  );
exception
  when invalid_text_representation
    or numeric_value_out_of_range
    or invalid_parameter_value then
    return false;
end
$$;

revoke all on function public.visionfood_direct_stock_request_fits(uuid,jsonb)
from public,anon,authenticated;
grant execute on function public.visionfood_direct_stock_request_fits(uuid,jsonb)
to service_role;


create or replace function public.quote_order_checkout(
  _organization_id uuid,
  _order_type text default 'local'::text,
  _bairro_id uuid default null::uuid,
  _delivery_fee numeric default 0,
  _items jsonb default '[]'::jsonb,
  _coupon_code text default ''::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  _item jsonb;
  _product public.products%rowtype;
  _qty numeric;
  _weight numeric;
  _extras_total numeric;
  _line_total numeric;
  _subtotal numeric:=0;
  _extra_name text;
  _extra_price numeric;
  _org public.organizations%rowtype;
  _fee numeric:=0;
  _bairro public.taxas_entrega%rowtype;
  _mode text;
  _coupon public.cupons%rowtype;
  _coupon_type text;
  _coupon_discount numeric:=0;
  _prime_discount numeric:=0;
  _prime_free boolean:=false;
  _prime_pct numeric:=0;
  _prime_min numeric:=0;
  _discount numeric:=0;
  _total numeric:=0;
begin
  perform public.visionfood_assert_checkout_item_weights(_organization_id,_items);

  select *
    into _org
    from public.organizations
   where id=_organization_id;

  if not found
     or coalesce(_org.ativo,false) is not true
     or coalesce(_org.bloqueado,false) is true
     or coalesce(_org.status,'ativo')<>'ativo'
     or coalesce(_org.status_assinatura,'ativo')<>'ativo' then
    raise exception 'organization is not accepting orders';
  end if;

  if _order_type not in ('local','viagem','delivery') then
    raise exception 'invalid order_type';
  end if;

  if _items is null
     or jsonb_typeof(_items)<>'array'
     or jsonb_array_length(_items)=0 then
    raise exception 'items must be a non-empty array';
  end if;

  if not public.visionfood_direct_stock_request_fits(_organization_id,_items) then
    raise exception 'insufficient direct stock';
  end if;

  for _item in
    select value from jsonb_array_elements(_items)
  loop
    select *
      into _product
      from public.products
     where id=(_item->>'product_id')::uuid
       and organization_id=_organization_id
       and coalesce(available,true)=true;

    if not found
       or not (coalesce(_product.ingredient_stock_blocked,false)=false) then
      raise exception 'product is invalid or unavailable';
    end if;

    _qty:=coalesce(nullif(_item->>'quantity','')::numeric,1);
    if _qty<=0 or _qty<>trunc(_qty) or _qty>100 then
      raise exception 'invalid quantity';
    end if;

    _weight:=nullif(_item->>'weight_kg','')::numeric;
    if _weight is not null and (_weight<=0 or _weight>100) then
      raise exception 'invalid weight';
    end if;

    _extras_total:=0;
    for _extra_name in
      select jsonb_array_elements_text(coalesce(_item->'extras','[]'::jsonb))
    loop
      select (x->>'price')::numeric
        into _extra_price
        from jsonb_array_elements(coalesce(_product.extras,'[]'::jsonb)) x
       where x->>'name'=_extra_name
       limit 1;

      if _extra_price is null or _extra_price<0 then
        raise exception 'invalid extra for product';
      end if;
      _extras_total:=_extras_total+_extra_price;
    end loop;

    _line_total:=round(
      (_product.price+_extras_total)
      * case when _weight is not null then _weight else _qty end,
      2
    );
    _subtotal:=_subtotal+_line_total;
  end loop;

  if _order_type in ('viagem','delivery') then
    select coalesce(delivery_mode,'bairros')
      into _mode
      from public.settings
     where organization_id=_organization_id
     limit 1;

    _mode:=coalesce(_mode,'bairros');

    if _mode='bairros' then
      if _bairro_id is null then
        raise exception 'bairro is required';
      end if;

      select *
        into _bairro
        from public.taxas_entrega
       where id=_bairro_id
         and organization_id=_organization_id
         and ativo=true;

      if not found then
        raise exception 'bairro is invalid or inactive';
      end if;
      _fee:=greatest(coalesce(_bairro.valor_taxa,_bairro.taxa_entrega,0),0);
    else
      if _bairro_id is not null then
        raise exception 'bairro_id is invalid for delivery mode';
      end if;
      _fee:=greatest(coalesce(_delivery_fee,0),0);
    end if;
  end if;

  if nullif(btrim(coalesce(_coupon_code,'')),'') is not null then
    select *
      into _coupon
      from public.cupons
     where organization_id=_organization_id
       and upper(codigo)=upper(btrim(_coupon_code))
     limit 1;

    if not found
       or coalesce(_coupon.ativo,false) is not true
       or coalesce(_coupon.status,true) is not true then
      raise exception 'coupon is invalid or inactive';
    end if;

    if coalesce(_coupon.data_inicio,'-infinity'::timestamptz)>now()
       or coalesce(_coupon.data_fim,_coupon.validade,'infinity'::timestamptz)<now() then
      raise exception 'coupon is outside validity period';
    end if;

    if _subtotal<greatest(coalesce(_coupon.minimo_pedido,0),0) then
      raise exception 'coupon minimum not reached';
    end if;

    _coupon_type:=lower(coalesce(nullif(_coupon.tipo,''),_coupon.tipo_desconto,''));
    if _coupon_type in ('porcentagem','percent','percentage') then
      _coupon_discount:=round(
        _subtotal*greatest(least(_coupon.valor,100),0)/100,
        2
      );
    elsif _coupon_type in ('valor_fixo','fixed','fixo') then
      _coupon_discount:=least(_subtotal,greatest(_coupon.valor,0));
    else
      raise exception 'coupon discount type is invalid';
    end if;
  end if;

  if auth.uid() is not null
     and exists(
       select 1
       from public.vision_prime_assinaturas a
       where a.organization_id=_organization_id
         and a.user_id=auth.uid()
         and a.status='active'
         and (a.expires_at is null or a.expires_at>now())
     ) then
    select
      greatest(coalesce(c.desconto_percentual,0),0),
      greatest(coalesce(c.frete_gratis_minimo,0),0)
    into _prime_pct,_prime_min
    from public.vision_prime_config c
    where c.organization_id=_organization_id
      and c.ativo=true
    limit 1;

    _prime_discount:=round(_subtotal*least(_prime_pct,100)/100,2);
    _prime_free:=_order_type in ('viagem','delivery') and _subtotal>=_prime_min;
  end if;

  _discount:=least(_subtotal,_coupon_discount+_prime_discount);
  if _prime_free then
    _fee:=0;
  end if;

  _total:=round(greatest(0,_subtotal-_discount+_fee),2);

  return jsonb_build_object(
    'subtotal',round(_subtotal,2),
    'coupon_discount',round(_coupon_discount,2),
    'prime_discount',round(_prime_discount,2),
    'discount',round(_discount,2),
    'delivery_fee',round(_fee,2),
    'prime_shipping_waived',_prime_free,
    'total',_total
  );
end
$function$;

revoke all on function public.quote_order_checkout(uuid,text,uuid,numeric,jsonb,text)
from public,anon;
grant execute on function public.quote_order_checkout(uuid,text,uuid,numeric,jsonb,text)
to authenticated,service_role;


-- Keep the existing PDV PIX implementation intact and inject only the exact
-- direct-stock guard before an intent can be issued. The final sale still uses
-- the atomic order INSERT stock trigger.
do $migration$
declare
  f text;
  patched text;
begin
  select pg_get_functiondef(
    'public.pdv_create_pix_intent_v2(text,uuid,jsonb,text)'::regprocedure
  )
  into f;

  if position(
    'visionfood_direct_stock_request_fits(s.organization_id, canonical_items)'
    in f
  )=0 then
    patched:=regexp_replace(
      f,
      'IF[[:space:]]+insufficient_stock[[:space:]]+THEN',
      'IF insufficient_stock OR NOT public.visionfood_direct_stock_request_fits(s.organization_id, canonical_items) THEN',
      'i'
    );

    if patched=f then
      raise exception 'pdv PIX direct-stock guard injection point not found';
    end if;

    execute patched;
  end if;
end
$migration$;


do $constraint$
begin
  if not exists(
    select 1
    from pg_catalog.pg_constraint c
    where c.conname='visionfood_products_stock_quantity_nonnegative'
      and c.conrelid='public.products'::regclass
  ) then
    alter table public.products
      add constraint visionfood_products_stock_quantity_nonnegative
      check (stock_quantity >= 0) not valid;
  end if;
end
$constraint$;
