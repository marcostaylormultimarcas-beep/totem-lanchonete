-- Phase 46D: server-authoritative checkout quote for products, extras, coupon, Prime and delivery.
CREATE OR REPLACE FUNCTION public.quote_order_checkout(_organization_id uuid, _order_type text DEFAULT 'local'::text, _bairro_id uuid DEFAULT NULL::uuid, _delivery_fee numeric DEFAULT 0, _items jsonb DEFAULT '[]'::jsonb, _coupon_code text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 _item jsonb; _product public.products%rowtype; _qty numeric; _weight numeric; _extras_total numeric; _line_total numeric; _subtotal numeric:=0; _extra_name text; _extra_price numeric;
 _org public.organizations%rowtype; _fee numeric:=0; _bairro public.taxas_entrega%rowtype; _mode text; _coupon public.cupons%rowtype; _coupon_type text; _coupon_discount numeric:=0;
 _prime_discount numeric:=0; _prime_free boolean:=false; _prime_pct numeric:=0; _prime_min numeric:=0; _discount numeric:=0; _total numeric:=0;
begin
 select * into _org from public.organizations where id=_organization_id;
 if not found or coalesce(_org.ativo,false) is not true or coalesce(_org.bloqueado,false) is true or coalesce(_org.status,'ativo')<>'ativo' or coalesce(_org.status_assinatura,'ativo')<>'ativo' then raise exception 'organization is not accepting orders'; end if;
 if _order_type not in ('local','viagem','delivery') then raise exception 'invalid order_type'; end if;
 if _items is null or jsonb_typeof(_items)<>'array' or jsonb_array_length(_items)=0 then raise exception 'items must be a non-empty array'; end if;
 for _item in select value from jsonb_array_elements(_items) loop
   select * into _product from public.products where id=(_item->>'product_id')::uuid and organization_id=_organization_id and coalesce(available,true)=true;
   if not found then raise exception 'product is invalid or unavailable'; end if;
   _qty:=coalesce(nullif(_item->>'quantity','')::numeric,1);
   if _qty<=0 or _qty<>trunc(_qty) or _qty>100 then raise exception 'invalid quantity'; end if;
   _weight:=nullif(_item->>'weight_kg','')::numeric;
   if _weight is not null and (_weight<=0 or _weight>100) then raise exception 'invalid weight'; end if;
   _extras_total:=0;
   for _extra_name in select jsonb_array_elements_text(coalesce(_item->'extras','[]'::jsonb)) loop
     select (x->>'price')::numeric into _extra_price from jsonb_array_elements(coalesce(_product.extras,'[]'::jsonb)) x where x->>'name'=_extra_name limit 1;
     if _extra_price is null or _extra_price<0 then raise exception 'invalid extra for product'; end if;
     _extras_total:=_extras_total+_extra_price;
   end loop;
   _line_total:=round((_product.price+_extras_total)*case when _weight is not null then _weight else _qty end,2);
   _subtotal:=_subtotal+_line_total;
 end loop;
 if _order_type in ('viagem','delivery') then
   select coalesce(delivery_mode,'bairros') into _mode from public.settings where organization_id=_organization_id limit 1;
   _mode:=coalesce(_mode,'bairros');
   if _mode='bairros' then
     if _bairro_id is null then raise exception 'bairro is required'; end if;
     select * into _bairro from public.taxas_entrega where id=_bairro_id and organization_id=_organization_id and ativo=true;
     if not found then raise exception 'bairro is invalid or inactive'; end if;
     _fee:=greatest(coalesce(_bairro.valor_taxa,_bairro.taxa_entrega,0),0);
   else
     if _bairro_id is not null then raise exception 'bairro_id is invalid for delivery mode'; end if;
     _fee:=greatest(coalesce(_delivery_fee,0),0);
   end if;
 end if;
 if nullif(btrim(coalesce(_coupon_code,'')),'') is not null then
   select * into _coupon from public.cupons where organization_id=_organization_id and upper(codigo)=upper(btrim(_coupon_code)) limit 1;
   if not found or coalesce(_coupon.ativo,false) is not true or coalesce(_coupon.status,true) is not true then raise exception 'coupon is invalid or inactive'; end if;
   if coalesce(_coupon.data_inicio,'-infinity'::timestamptz)>now() or coalesce(_coupon.data_fim,_coupon.validade,'infinity'::timestamptz)<now() then raise exception 'coupon is outside validity period'; end if;
   if _subtotal<greatest(coalesce(_coupon.minimo_pedido,0),0) then raise exception 'coupon minimum not reached'; end if;
   _coupon_type:=lower(coalesce(nullif(_coupon.tipo,''),_coupon.tipo_desconto,''));
   if _coupon_type in ('porcentagem','percent','percentage') then _coupon_discount:=round(_subtotal*greatest(least(_coupon.valor,100),0)/100,2);
   elsif _coupon_type in ('valor_fixo','fixed','fixo') then _coupon_discount:=least(_subtotal,greatest(_coupon.valor,0));
   else raise exception 'coupon discount type is invalid'; end if;
 end if;
 if auth.uid() is not null and exists(select 1 from public.vision_prime_assinaturas a where a.organization_id=_organization_id and a.user_id=auth.uid() and a.status='active' and (a.expires_at is null or a.expires_at>now())) then
   select greatest(coalesce(c.desconto_percentual,0),0),greatest(coalesce(c.frete_gratis_minimo,0),0) into _prime_pct,_prime_min from public.vision_prime_config c where c.organization_id=_organization_id and c.ativo=true limit 1;
   _prime_discount:=round(_subtotal*least(_prime_pct,100)/100,2);
   _prime_free:=_order_type in ('viagem','delivery') and _subtotal>=_prime_min;
 end if;
 _discount:=least(_subtotal,_coupon_discount+_prime_discount);
 if _prime_free then _fee:=0; end if;
 _total:=round(greatest(0,_subtotal-_discount+_fee),2);
 return jsonb_build_object('subtotal',round(_subtotal,2),'coupon_discount',round(_coupon_discount,2),'prime_discount',round(_prime_discount,2),'discount',round(_discount,2),'delivery_fee',round(_fee,2),'prime_shipping_waived',_prime_free,'total',_total);
end $function$
;
revoke all on function public.quote_order_checkout(uuid,text,uuid,numeric,jsonb,text) from public;
grant execute on function public.quote_order_checkout(uuid,text,uuid,numeric,jsonb,text) to anon,authenticated;
