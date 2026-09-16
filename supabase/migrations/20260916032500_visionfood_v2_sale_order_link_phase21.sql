-- VisionFood V2 phase 21
-- Keep the legacy caixa_movimentos.pedido_id FK intact while linking new PDV orders safely.
CREATE OR REPLACE FUNCTION public.pdv_registrar_venda_v2(_session_token text, _caixa_id uuid, _items jsonb, _forma text, _total numeric, _cupom_code text DEFAULT ''::text, _desconto numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
 s public.pdv_sessions%rowtype; c public.caixas_pdv%rowtype; op public.operadores_pdv%rowtype; h text; oid uuid; onum text; ts timestamptz:=now();
 item jsonb; p public.products%rowtype; canonical_items jsonb:='[]'::jsonb; qty integer; subtotal numeric:=0; discount numeric:=0; final_total numeric:=0; coupon public.cupons%rowtype; code text:=upper(btrim(coalesce(_cupom_code,'')));
BEGIN
 h:=encode(extensions.digest(coalesce(_session_token,''),'sha256'),'hex');
 SELECT * INTO s FROM public.pdv_sessions WHERE token_hash=h AND revoked_at IS NULL AND expires_at>now();
 IF s.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;
 SELECT * INTO c FROM public.caixas_pdv WHERE id=_caixa_id AND organization_id=s.organization_id AND operador_id=s.operador_id AND status IN ('open','aberto');
 IF c.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_cash_register'); END IF;
 IF jsonb_typeof(_items)<>'array' OR jsonb_array_length(_items)=0 OR coalesce(_forma,'') NOT IN ('dinheiro','pix','cartao') THEN RETURN jsonb_build_object('ok',false,'reason','invalid_sale'); END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(_items) LOOP
   BEGIN qty := (item->>'quantity')::integer; EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'reason','invalid_quantity'); END;
   IF qty IS NULL OR qty<=0 OR qty>999 THEN RETURN jsonb_build_object('ok',false,'reason','invalid_quantity'); END IF;
   SELECT * INTO p FROM public.products WHERE id=(item->>'product_id')::uuid AND organization_id=s.organization_id AND coalesce(available,true)=true;
   IF p.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','product_not_found','product_id',item->>'product_id'); END IF;
   subtotal:=subtotal+(p.price*qty);
   canonical_items:=canonical_items || jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'price',p.price,'quantity',qty));
 END LOOP;
 IF code<>'' THEN
   SELECT * INTO coupon FROM public.cupons WHERE organization_id=s.organization_id AND upper(codigo)=code AND ativo=true AND coalesce(status,true)=true AND (validade IS NULL OR validade>=ts) AND (data_inicio IS NULL OR data_inicio<=ts) AND (data_fim IS NULL OR data_fim>=ts) LIMIT 1;
   IF coupon.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_coupon'); END IF;
   IF subtotal < coalesce(coupon.minimo_pedido,0) THEN RETURN jsonb_build_object('ok',false,'reason','coupon_minimum_not_met'); END IF;
   IF lower(coalesce(coupon.tipo_desconto,coupon.tipo,'')) IN ('percentual','porcentagem','percent','percentage') THEN discount:=round(subtotal*greatest(0,least(coupon.valor,100))/100,2); ELSE discount:=least(subtotal,greatest(0,coupon.valor)); END IF;
 END IF;
 final_total:=greatest(0,subtotal-discount);
 SELECT * INTO op FROM public.operadores_pdv WHERE id=s.operador_id;
 onum:=to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
 INSERT INTO public.orders(order_number,customer_name,customer_phone,order_type,items,total,status,organization_id,payment_method,forma_pagamento,metodo_pagamento,created_at,updated_at)
 VALUES(onum,'Balcão','','pdv',canonical_items,final_total,'delivered',s.organization_id,_forma,_forma,_forma,ts,ts) RETURNING id INTO oid;
 INSERT INTO public.caixa_movimentos(caixa_id,organization_id,operador_id,operador_nome,tipo,forma_pagamento,valor,motivo,pedido_id,metadata)
 VALUES(c.id,s.organization_id,s.operador_id,coalesce(op.name,op.nome,op.username,''),'venda',_forma,final_total,'Venda PDV',NULL,jsonb_build_object('order_id',oid,'cupom',code,'desconto',discount,'subtotal',subtotal,'client_total_ignored',_total,'client_discount_ignored',_desconto));
 IF coupon.id IS NOT NULL THEN UPDATE public.cupons SET usos=coalesce(usos,0)+1,updated_at=now() WHERE id=coupon.id; END IF;
 UPDATE public.pdv_sessions SET last_seen_at=now() WHERE id=s.id;
 RETURN jsonb_build_object('ok',true,'order_id',oid,'order_number',onum,'created_at',ts,'subtotal',subtotal,'desconto',discount,'total',final_total,'items',canonical_items);
EXCEPTION WHEN invalid_text_representation THEN
 RETURN jsonb_build_object('ok',false,'reason','invalid_product_id');
END $function$;

REVOKE ALL ON FUNCTION public.pdv_registrar_venda_v2(text,uuid,jsonb,text,numeric,text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_registrar_venda_v2(text,uuid,jsonb,text,numeric,text,numeric) TO anon,authenticated;
