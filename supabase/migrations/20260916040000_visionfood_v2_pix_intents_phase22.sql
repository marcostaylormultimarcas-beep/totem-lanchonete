-- VisionFood V2 / Phase 22
-- Secure server-authoritative PIX intents for PDV.
-- Reconstructed from the verified state of Supabase project udhcnpauymevkylldkir.

create table if not exists public.pdv_pix_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  session_id uuid not null,
  operador_id uuid not null,
  caixa_id uuid not null,
  items jsonb not null,
  cupom_code text,
  amount numeric not null,
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pdv_pix_intents enable row level security;

create or replace function public.pdv_create_pix_intent_v2(_session_token text, _caixa_id uuid, _items jsonb, _cupom_code text default '')
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $$
declare
 s public.pdv_sessions%rowtype; c public.caixas_pdv%rowtype; h text; item jsonb; p public.products%rowtype; qty integer; subtotal numeric:=0; discount numeric:=0; final_total numeric:=0; coupon public.cupons%rowtype; code text:=upper(btrim(coalesce(_cupom_code,''))); iid uuid; canonical_items jsonb:='[]'::jsonb; ts timestamptz:=now();
begin
 h:=encode(extensions.digest(coalesce(_session_token,''),'sha256'),'hex');
 select * into s from public.pdv_sessions where token_hash=h and revoked_at is null and expires_at>now();
 if s.id is null then return jsonb_build_object('ok',false,'reason','invalid_session'); end if;
 select * into c from public.caixas_pdv where id=_caixa_id and organization_id=s.organization_id and operador_id=s.operador_id and status in ('open','aberto');
 if c.id is null then return jsonb_build_object('ok',false,'reason','invalid_cash_register'); end if;
 if jsonb_typeof(_items)<>'array' or jsonb_array_length(_items)=0 then return jsonb_build_object('ok',false,'reason','invalid_sale'); end if;
 for item in select value from jsonb_array_elements(_items) loop
   begin qty:=(item->>'quantity')::integer; exception when others then return jsonb_build_object('ok',false,'reason','invalid_quantity'); end;
   if qty is null or qty<=0 or qty>999 then return jsonb_build_object('ok',false,'reason','invalid_quantity'); end if;
   begin select * into p from public.products where id=(item->>'product_id')::uuid and organization_id=s.organization_id and coalesce(available,true)=true; exception when invalid_text_representation then return jsonb_build_object('ok',false,'reason','invalid_product_id'); end;
   if p.id is null then return jsonb_build_object('ok',false,'reason','product_not_found'); end if;
   subtotal:=subtotal+(p.price*qty);
   canonical_items:=canonical_items||jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'price',p.price,'quantity',qty));
 end loop;
 if code<>'' then
   select * into coupon from public.cupons where organization_id=s.organization_id and upper(codigo)=code and ativo=true and coalesce(status,true)=true and (validade is null or validade>=ts) and (data_inicio is null or data_inicio<=ts) and (data_fim is null or data_fim>=ts) limit 1;
   if coupon.id is null then return jsonb_build_object('ok',false,'reason','invalid_coupon'); end if;
   if subtotal<coalesce(coupon.minimo_pedido,0) then return jsonb_build_object('ok',false,'reason','coupon_minimum_not_met'); end if;
   if lower(coalesce(coupon.tipo_desconto,coupon.tipo,'')) in ('percentual','porcentagem','percent','percentage') then discount:=round(subtotal*greatest(0,least(coupon.valor,100))/100,2); else discount:=least(subtotal,greatest(0,coupon.valor)); end if;
 end if;
 final_total:=greatest(0,subtotal-discount);
 if final_total<=0 then return jsonb_build_object('ok',false,'reason','invalid_total'); end if;
 insert into public.pdv_pix_intents(organization_id,session_id,operador_id,caixa_id,items,cupom_code,amount) values(s.organization_id,s.id,s.operador_id,c.id,canonical_items,code,final_total) returning id into iid;
 update public.pdv_sessions set last_seen_at=now() where id=s.id;
 return jsonb_build_object('ok',true,'intent_id',iid,'amount',final_total,'expires_in_seconds',900);
end $$;

create or replace function public.pdv_claim_pix_intent_internal(_intent_id uuid, _session_token text)
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $$
declare s public.pdv_sessions%rowtype; i public.pdv_pix_intents%rowtype; h text;
begin
 h:=encode(extensions.digest(coalesce(_session_token,''),'sha256'),'hex');
 select * into s from public.pdv_sessions where token_hash=h and revoked_at is null and expires_at>now();
 if s.id is null then return jsonb_build_object('ok',false,'reason','invalid_session'); end if;
 select * into i from public.pdv_pix_intents where id=_intent_id and session_id=s.id and organization_id=s.organization_id and status='pending' and expires_at>now() for update;
 if i.id is null then return jsonb_build_object('ok',false,'reason','invalid_intent'); end if;
 update public.pdv_pix_intents set status='payment_created',updated_at=now() where id=i.id;
 return jsonb_build_object('ok',true,'intent_id',i.id,'organization_id',i.organization_id,'amount',i.amount);
end $$;

revoke all on function public.pdv_claim_pix_intent_internal(uuid,text) from public, anon, authenticated;
revoke all on table public.pdv_pix_intents from anon, authenticated;
revoke all on function public.pdv_create_pix_intent_v2(text,uuid,jsonb,text) from public;
grant execute on function public.pdv_create_pix_intent_v2(text,uuid,jsonb,text) to anon, authenticated;
