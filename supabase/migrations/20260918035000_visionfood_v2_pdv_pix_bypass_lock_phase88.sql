-- Phase 88: generic PDV sale cannot self-declare PIX as paid.
-- PIX sales must use pdv_registrar_venda_pix_v2 after a paid intent is confirmed.
create or replace function public.pdv_registrar_venda_v2(
 _session_token text,_caixa_id uuid,_items jsonb,_forma text,_total numeric,_cupom_code text default '',_desconto numeric default 0
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 s public.pdv_sessions%rowtype; c public.caixas_pdv%rowtype; op public.operadores_pdv%rowtype; h text; oid uuid; onum text; ts timestamptz:=now();
 item jsonb; p public.products%rowtype; canonical_items jsonb:='[]'::jsonb; qty integer; subtotal numeric:=0; discount numeric:=0; final_total numeric:=0; coupon public.cupons%rowtype; code text:=upper(btrim(coalesce(_cupom_code,'')));
begin
 h:=encode(extensions.digest(coalesce(_session_token,''),'sha256'),'hex');
 select * into s from public.pdv_sessions where token_hash=h and revoked_at is null and expires_at>now();
 if s.id is null then return jsonb_build_object('ok',false,'reason','invalid_session'); end if;
 select * into c from public.caixas_pdv where id=_caixa_id and organization_id=s.organization_id and operador_id=s.operador_id and status in ('open','aberto');
 if c.id is null then return jsonb_build_object('ok',false,'reason','invalid_cash_register'); end if;
 if jsonb_typeof(_items)<>'array' or jsonb_array_length(_items)=0 or coalesce(_forma,'') not in ('dinheiro','cartao') then return jsonb_build_object('ok',false,'reason','invalid_sale'); end if;
 for item in select value from jsonb_array_elements(_items) loop
   begin qty := (item->>'quantity')::integer; exception when others then return jsonb_build_object('ok',false,'reason','invalid_quantity'); end;
   if qty is null or qty<=0 or qty>999 then return jsonb_build_object('ok',false,'reason','invalid_quantity'); end if;
   select * into p from public.products where id=(item->>'product_id')::uuid and organization_id=s.organization_id and coalesce(available,true)=true;
   if p.id is null then return jsonb_build_object('ok',false,'reason','product_not_found','product_id',item->>'product_id'); end if;
   subtotal:=subtotal+(p.price*qty);
   canonical_items:=canonical_items || jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'price',p.price,'quantity',qty));
 end loop;
 if code<>'' then
   select * into coupon from public.cupons where organization_id=s.organization_id and upper(codigo)=code and ativo=true and coalesce(status,true)=true and (validade is null or validade>=ts) and (data_inicio is null or data_inicio<=ts) and (data_fim is null or data_fim>=ts) limit 1;
   if coupon.id is null then return jsonb_build_object('ok',false,'reason','invalid_coupon'); end if;
   if subtotal < coalesce(coupon.minimo_pedido,0) then return jsonb_build_object('ok',false,'reason','coupon_minimum_not_met'); end if;
   if lower(coalesce(coupon.tipo_desconto,coupon.tipo,'')) in ('percentual','porcentagem','percent','percentage') then discount:=round(subtotal*greatest(0,least(coupon.valor,100))/100,2); else discount:=least(subtotal,greatest(0,coupon.valor)); end if;
 end if;
 final_total:=greatest(0,subtotal-discount);
 select * into op from public.operadores_pdv where id=s.operador_id;
 onum:=public.next_order_number(s.organization_id);
 insert into public.orders(order_number,customer_name,customer_phone,order_type,items,total,status,organization_id,payment_method,forma_pagamento,metodo_pagamento,created_at,updated_at)
 values(onum,'Balcão','','pdv',canonical_items,final_total,'delivered',s.organization_id,_forma,_forma,_forma,ts,ts) returning id into oid;
 insert into public.caixa_movimentos(caixa_id,organization_id,operador_id,operador_nome,tipo,forma_pagamento,valor,motivo,pedido_id,metadata)
 values(c.id,s.organization_id,s.operador_id,coalesce(op.name,op.nome,op.username,''),'venda',_forma,final_total,'Venda PDV',NULL,jsonb_build_object('order_id',oid,'cupom',code,'desconto',discount,'subtotal',subtotal,'client_total_ignored',_total,'client_discount_ignored',_desconto));
 if coupon.id is not null then update public.cupons set usos=coalesce(usos,0)+1,updated_at=now() where id=coupon.id; end if;
 update public.pdv_sessions set last_seen_at=now() where id=s.id;
 return jsonb_build_object('ok',true,'order_id',oid,'order_number',onum,'created_at',ts,'subtotal',subtotal,'desconto',discount,'total',final_total,'items',canonical_items);
exception when invalid_text_representation then
 return jsonb_build_object('ok',false,'reason','invalid_product_id');
end$$;
revoke all on function public.pdv_registrar_venda_v2(text,uuid,jsonb,text,numeric,text,numeric) from public;
grant execute on function public.pdv_registrar_venda_v2(text,uuid,jsonb,text,numeric,text,numeric) to anon,authenticated,service_role;
