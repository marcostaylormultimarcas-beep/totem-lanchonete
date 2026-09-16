-- VisionFood V2 / Phase 24
-- Bind one approved PIX intent to exactly one completed order.

alter table public.pdv_pix_intents add column if not exists order_id uuid;
create unique index if not exists ux_pdv_pix_intents_order_id on public.pdv_pix_intents(order_id) where order_id is not null;

create or replace function public.pdv_registrar_venda_pix_v2(_session_token text, _intent_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $$
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
 onum:=to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
 insert into public.orders(order_number,customer_name,customer_phone,order_type,items,total,status,organization_id,payment_method,forma_pagamento,metodo_pagamento,created_at,updated_at)
 values(onum,'Balcão','','pdv',i.items,i.amount,'delivered',s.organization_id,'pix','pix','pix',ts,ts) returning id into oid;
 insert into public.caixa_movimentos(caixa_id,organization_id,operador_id,operador_nome,tipo,forma_pagamento,valor,motivo,pedido_id,metadata)
 values(c.id,s.organization_id,s.operador_id,coalesce(op.name,op.nome,op.username,''),'venda','pix',i.amount,'Venda PDV PIX',NULL,jsonb_build_object('order_id',oid,'pix_intent_id',i.id,'mp_payment_id',i.mp_payment_id));
 update public.pdv_pix_intents set order_id=oid,updated_at=now() where id=i.id;
 update public.pdv_sessions set last_seen_at=now() where id=s.id;
 return jsonb_build_object('ok',true,'idempotent',false,'order_id',oid,'order_number',onum,'created_at',ts,'total',i.amount,'items',i.items);
end $$;

revoke all on function public.pdv_registrar_venda_pix_v2(text,uuid) from public;
grant execute on function public.pdv_registrar_venda_pix_v2(text,uuid) to anon, authenticated;
