-- Phase 46E: final order creation recomputes the authoritative quote and ignores client total.
CREATE OR REPLACE FUNCTION public.create_order_checkout(_organization_id uuid, _customer_name text, _customer_phone text DEFAULT ''::text, _customer_cpf text DEFAULT ''::text, _order_type text DEFAULT 'local'::text, _delivery_address text DEFAULT ''::text, _delivery_reference text DEFAULT ''::text, _delivery_recipient text DEFAULT ''::text, _bairro_id uuid DEFAULT NULL::uuid, _bairro_nome text DEFAULT ''::text, _delivery_fee numeric DEFAULT 0, _items jsonb DEFAULT '[]'::jsonb, _total numeric DEFAULT 0, _payment_method text DEFAULT ''::text, _scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone, _coupon_code text DEFAULT ''::text)
 RETURNS TABLE(id uuid, order_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 _quote jsonb; _server_total numeric; _server_fee numeric; _n bigint; _candidate text; _id uuid; _item jsonb; _product public.products%rowtype; _qty numeric; _weight numeric; _extras_total numeric; _line_total numeric; _extra_name text; _extra_price numeric; _canonical_items jsonb:='[]'::jsonb; _org public.organizations%rowtype;
begin
 select * into _org from public.organizations where organizations.id=_organization_id;
 if not found or coalesce(_org.ativo,false) is not true or coalesce(_org.bloqueado,false) is true or coalesce(_org.status,'ativo')<>'ativo' or coalesce(_org.status_assinatura,'ativo')<>'ativo' then raise exception 'organization is not accepting orders'; end if;
 if nullif(btrim(_customer_name),'') is null then raise exception 'customer_name is required'; end if;
 _quote:=public.quote_order_checkout(_organization_id,_order_type,_bairro_id,_delivery_fee,_items,_coupon_code);
 _server_total:=(_quote->>'total')::numeric; _server_fee:=(_quote->>'delivery_fee')::numeric;
 for _item in select value from jsonb_array_elements(_items) loop
  select * into _product from public.products where products.id=(_item->>'product_id')::uuid and products.organization_id=_organization_id and coalesce(products.available,true)=true;
  _qty:=coalesce(nullif(_item->>'quantity','')::numeric,1); _weight:=nullif(_item->>'weight_kg','')::numeric; _extras_total:=0;
  for _extra_name in select jsonb_array_elements_text(coalesce(_item->'extras','[]'::jsonb)) loop
   select (x->>'price')::numeric into _extra_price from jsonb_array_elements(coalesce(_product.extras,'[]'::jsonb)) x where x->>'name'=_extra_name limit 1;
   _extras_total:=_extras_total+coalesce(_extra_price,0);
  end loop;
  _line_total:=round((_product.price+_extras_total)*case when _weight is not null then _weight else _qty end,2);
  _canonical_items:=_canonical_items||jsonb_build_array(jsonb_build_object('product_id',_product.id,'name',_product.name,'quantity',case when _weight is not null then 1 else _qty end,'price',_product.price,'total',_line_total,'removedIngredients',coalesce(_item->'removedIngredients','[]'::jsonb),'extras',coalesce(_item->'extras','[]'::jsonb),'weight_kg',_weight,'price_per_kg',case when _weight is not null then _product.price else null end,'sold_by_weight',(_weight is not null)));
 end loop;
 loop
  insert into public.order_number_counters(organization_id,last_number) values(_organization_id,1)
  on conflict(organization_id) do update set last_number=public.order_number_counters.last_number+1,updated_at=now() returning last_number into _n;
  _candidate:=lpad(_n::text,3,'0');
  exit when not exists(select 1 from public.orders o where o.organization_id=_organization_id and o.order_number=_candidate);
 end loop;
 insert into public.orders(organization_id,order_number,customer_name,customer_phone,customer_cpf,order_type,delivery_address,delivery_reference,delivery_recipient,items,total,status,payment_method,user_id,scheduled_for)
 values(_organization_id,_candidate,btrim(_customer_name),coalesce(_customer_phone,''),coalesce(_customer_cpf,''),_order_type,coalesce(_delivery_address,''),coalesce(_delivery_reference,''),coalesce(_delivery_recipient,''),_canonical_items,_server_total,'pending',coalesce(_payment_method,''),auth.uid(),_scheduled_for)
 returning orders.id into _id;
 return query select _id,_candidate;
end $function$
;
revoke all on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text) from public;
grant execute on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text) to anon,authenticated;
revoke execute on function public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz) from anon,authenticated,public;
