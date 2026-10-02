-- Phase 90: exact reproducibility snapshot of installed critical PDV/driver functions.
-- Generated from pg_get_functiondef on the official Supabase project.

CREATE OR REPLACE FUNCTION public.entregador_login_session(_org_slug text, _username text, _password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE v_login jsonb; v_token text; v_driver_id uuid; v_org_id uuid; BEGIN v_login:=public.entregador_login(_org_slug,_username,_password); IF COALESCE((v_login->>'ok')::boolean,false) IS NOT TRUE THEN RETURN v_login; END IF; v_driver_id:=(v_login->'entregador'->>'id')::uuid; v_org_id:=(v_login->'entregador'->>'organization_id')::uuid; IF NOT EXISTS (SELECT 1 FROM public.entregadores e WHERE e.id=v_driver_id AND e.organization_id=v_org_id AND COALESCE(e.active,true)=true AND COALESCE(e.ativo,true)=true) THEN RETURN jsonb_build_object('ok',false,'reason','inactive_driver'); END IF; v_token:=encode(extensions.gen_random_bytes(32),'hex'); INSERT INTO public.entregador_sessions(entregador_id,organization_id,token_hash) VALUES(v_driver_id,v_org_id,encode(extensions.digest(v_token,'sha256'),'hex')); RETURN v_login || jsonb_build_object('session_token',v_token); END; $function$;

CREATE OR REPLACE FUNCTION public.entregador_logout_session(_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN IF _session_token IS NOT NULL THEN UPDATE public.entregador_sessions SET revoked_at=now() WHERE token_hash=encode(extensions.digest(_session_token,'sha256'),'hex') AND revoked_at IS NULL; END IF; RETURN jsonb_build_object('ok',true); END; $function$;

CREATE OR REPLACE FUNCTION public.entregador_session_driver(_token text)
 RETURNS entregadores
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE v_e public.entregadores%ROWTYPE; BEGIN IF _token IS NULL OR length(_token) < 32 THEN RETURN NULL; END IF; SELECT e.* INTO v_e FROM public.entregador_sessions s JOIN public.entregadores e ON e.id=s.entregador_id AND e.organization_id=s.organization_id WHERE s.token_hash=encode(extensions.digest(_token,'sha256'),'hex') AND s.revoked_at IS NULL AND s.expires_at>now() AND COALESCE(e.active,true)=true AND COALESCE(e.ativo,true)=true LIMIT 1; IF NOT FOUND THEN RETURN NULL; END IF; UPDATE public.entregador_sessions SET last_used_at=now() WHERE token_hash=encode(extensions.digest(_token,'sha256'),'hex') AND revoked_at IS NULL; RETURN v_e; END; $function$;

CREATE OR REPLACE FUNCTION public.pdv_devolver_pedido_v2(_session_token text, _caixa_id uuid, _order_id uuid, _items_devolvidos jsonb, _valor_devolucao numeric, _motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 s public.pdv_sessions%rowtype; c public.caixas_pdv%rowtype; o public.orders%rowtype; op public.operadores_pdv%rowtype;
 h text; req jsonb; orig jsonb; canon jsonb := '[]'::jsonb; pid uuid; qty integer; oqty integer; unit_price numeric; calc_refund numeric := 0; prior_refund numeric := 0; remaining numeric;
begin
 h:=encode(extensions.digest(coalesce(_session_token,''),'sha256'),'hex');
 select * into s from public.pdv_sessions where token_hash=h and revoked_at is null and expires_at>now();
 if s.id is null then return jsonb_build_object('ok',false,'reason','invalid_session'); end if;
 select * into c from public.caixas_pdv where id=_caixa_id and organization_id=s.organization_id and operador_id=s.operador_id and status in ('open','aberto');
 if c.id is null then return jsonb_build_object('ok',false,'reason','invalid_cash_register'); end if;
 select * into o from public.orders where id=_order_id and organization_id=s.organization_id and order_type='pdv' for update;
 if o.id is null then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;
 if jsonb_typeof(_items_devolvidos)<>'array' or jsonb_array_length(_items_devolvidos)=0 or length(btrim(coalesce(_motivo,'')))<3 then return jsonb_build_object('ok',false,'reason','invalid_return'); end if;
 for req in select value from jsonb_array_elements(_items_devolvidos) loop
   begin pid := (req->>'product_id')::uuid; exception when others then return jsonb_build_object('ok',false,'reason','invalid_return_item'); end;
   begin qty := (req->>'quantity')::integer; exception when others then return jsonb_build_object('ok',false,'reason','invalid_return_quantity'); end;
   if qty is null or qty<=0 then return jsonb_build_object('ok',false,'reason','invalid_return_quantity'); end if;
   select value into orig from jsonb_array_elements(o.items) where value->>'product_id'=pid::text limit 1;
   if orig is null then return jsonb_build_object('ok',false,'reason','item_not_in_order'); end if;
   begin oqty := (orig->>'quantity')::integer; exception when others then return jsonb_build_object('ok',false,'reason','invalid_original_item'); end;
   begin unit_price := (orig->>'price')::numeric; exception when others then return jsonb_build_object('ok',false,'reason','invalid_original_price'); end;
   if qty>oqty or unit_price<0 then return jsonb_build_object('ok',false,'reason','return_quantity_exceeds_order'); end if;
   canon := canon || jsonb_build_array(jsonb_build_object('product_id',pid,'name',coalesce(orig->>'name',''),'quantity',qty,'price',unit_price));
   calc_refund := calc_refund + unit_price*qty;
 end loop;
 select coalesce(sum(valor),0) into prior_refund from public.caixa_movimentos where organization_id=s.organization_id and tipo='devolucao' and pedido_id=o.id;
 remaining := greatest(o.total-prior_refund,0);
 calc_refund := least(calc_refund, remaining);
 if calc_refund<=0 then return jsonb_build_object('ok',false,'reason','nothing_left_to_refund'); end if;
 select * into op from public.operadores_pdv where id=s.operador_id;
 insert into public.caixa_movimentos(caixa_id,organization_id,operador_id,operador_nome,tipo,forma_pagamento,valor,motivo,pedido_id,metadata)
 values(c.id,s.organization_id,s.operador_id,coalesce(op.name,op.nome,op.username,''),'devolucao',coalesce(o.forma_pagamento,o.payment_method,o.metodo_pagamento,'dinheiro'),calc_refund,btrim(_motivo),o.id,jsonb_build_object('order_id',o.id,'order_number',o.order_number,'items',canon,'client_requested_value',_valor_devolucao));
 update public.pdv_sessions set last_seen_at=now() where id=s.id;
 return jsonb_build_object('ok',true,'order_id',o.id,'valor_devolucao',calc_refund,'items',canon);
end $function$;

CREATE OR REPLACE FUNCTION public.pdv_registrar_venda_pix_v2(_session_token text, _intent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 s public.pdv_sessions%rowtype; i public.pdv_pix_intents%rowtype; c public.caixas_pdv%rowtype; op public.operadores_pdv%rowtype;
 h text; oid uuid; onum text; ts timestamptz:=now(); existing_order public.orders%rowtype;
begin
 h:=encode(extensions.digest(coalesce(_session_token,''),'sha256'),'hex');
 select * into s from public.pdv_sessions where token_hash=h and revoked_at is null and expires_at>now();
 if s.id is null then return jsonb_build_object('ok',false,'reason','invalid_session'); end if;
 select * into i from public.pdv_pix_intents where id=_intent_id and session_id=s.id and organization_id=s.organization_id for update;
 if i.id is null then return jsonb_build_object('ok',false,'reason','invalid_pix_intent'); end if;
 if lower(coalesce(i.payment_status,i.status,'')) not in ('approved','paid') or i.paid_at is null then return jsonb_build_object('ok',false,'reason','pix_not_paid'); end if;
 if i.order_id is not null then
   select * into existing_order from public.orders where id=i.order_id and organization_id=s.organization_id;
   return jsonb_build_object('ok',true,'idempotent',true,'order_id',i.order_id,'order_number',existing_order.order_number,'created_at',existing_order.created_at,'total',existing_order.total,'items',existing_order.items);
 end if;
 select * into c from public.caixas_pdv where id=i.caixa_id and organization_id=s.organization_id and operador_id=s.operador_id and status in ('open','aberto');
 if c.id is null then return jsonb_build_object('ok',false,'reason','invalid_cash_register'); end if;
 select * into op from public.operadores_pdv where id=s.operador_id;
 onum:=public.next_order_number(s.organization_id);
 insert into public.orders(order_number,customer_name,customer_phone,order_type,items,total,status,organization_id,payment_method,forma_pagamento,metodo_pagamento,created_at,updated_at)
 values(onum,'Balcão','','pdv',i.items,i.amount,'delivered',s.organization_id,'pix','pix','pix',ts,ts) returning id into oid;
 insert into public.caixa_movimentos(caixa_id,organization_id,operador_id,operador_nome,tipo,forma_pagamento,valor,motivo,pedido_id,metadata)
 values(c.id,s.organization_id,s.operador_id,coalesce(op.name,op.nome,op.username,''),'venda','pix',i.amount,'Venda PDV PIX',NULL,jsonb_build_object('order_id',oid,'pix_intent_id',i.id,'mp_payment_id',i.mp_payment_id));
 update public.pdv_pix_intents set order_id=oid,updated_at=now() where id=i.id;
 update public.pdv_sessions set last_seen_at=now() where id=s.id;
 return jsonb_build_object('ok',true,'idempotent',false,'order_id',oid,'order_number',onum,'created_at',ts,'total',i.amount,'items',i.items);
end $function$;

CREATE OR REPLACE FUNCTION public.pdv_registrar_venda_v2(_session_token text, _caixa_id uuid, _items jsonb, _forma text, _total numeric, _cupom_code text DEFAULT ''::text, _desconto numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end$function$;

-- Explicit EXECUTE contract
revoke all on function public.entregador_login_session(text,text,text) from public;
grant execute on function public.entregador_login_session(text,text,text) to anon,authenticated,service_role;
revoke all on function public.entregador_session_driver(text) from public,anon,authenticated;
grant execute on function public.entregador_session_driver(text) to service_role;
revoke all on function public.entregador_logout_session(text) from public;
grant execute on function public.entregador_logout_session(text) to anon,authenticated,service_role;
revoke all on function public.pdv_registrar_venda_v2(text,uuid,jsonb,text,numeric,text,numeric) from public;
grant execute on function public.pdv_registrar_venda_v2(text,uuid,jsonb,text,numeric,text,numeric) to anon,authenticated,service_role;
revoke all on function public.pdv_registrar_venda_pix_v2(text,uuid) from public;
grant execute on function public.pdv_registrar_venda_pix_v2(text,uuid) to anon,authenticated,service_role;
revoke all on function public.pdv_devolver_pedido_v2(text,uuid,uuid,jsonb,numeric,text) from public;
grant execute on function public.pdv_devolver_pedido_v2(text,uuid,uuid,jsonb,numeric,text) to anon,authenticated,service_role;
