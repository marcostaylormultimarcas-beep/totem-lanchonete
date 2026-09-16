-- VisionFood V2 / Phase 23
-- Mercado Pago payment binding and server-authoritative payment status.

alter table public.pdv_pix_intents add column if not exists mp_payment_id text;
alter table public.pdv_pix_intents add column if not exists payment_status text;
alter table public.pdv_pix_intents add column if not exists paid_at timestamptz;
alter table public.pdv_pix_intents add column if not exists mp_status_detail text;

create unique index if not exists idx_pdv_pix_intents_mp_payment_id on public.pdv_pix_intents(mp_payment_id) where mp_payment_id is not null;
create index if not exists idx_pdv_pix_intents_org_status on public.pdv_pix_intents(organization_id,status);

create or replace function public.pdv_bind_pix_payment_internal(_intent_id uuid, _payment_id text)
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $$
declare i public.pdv_pix_intents%rowtype;
begin
 if coalesce(btrim(_payment_id),'')='' then return jsonb_build_object('ok',false,'reason','invalid_payment_id'); end if;
 select * into i from public.pdv_pix_intents where id=_intent_id for update;
 if i.id is null then return jsonb_build_object('ok',false,'reason','intent_not_found'); end if;
 if i.mp_payment_id is not null and i.mp_payment_id<>_payment_id then return jsonb_build_object('ok',false,'reason','payment_already_bound'); end if;
 update public.pdv_pix_intents set mp_payment_id=_payment_id,payment_status=coalesce(payment_status,'pending'),updated_at=now() where id=i.id;
 return jsonb_build_object('ok',true,'intent_id',i.id,'organization_id',i.organization_id,'amount',i.amount);
end $$;

create or replace function public.pdv_update_pix_payment_internal(_payment_id text, _status text, _status_detail text default null, _amount numeric default null)
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $$
declare i public.pdv_pix_intents%rowtype; st text:=lower(coalesce(_status,''));
begin
 select * into i from public.pdv_pix_intents where mp_payment_id=_payment_id for update;
 if i.id is null then return jsonb_build_object('ok',false,'reason','intent_not_found'); end if;
 if _amount is not null and abs(i.amount-_amount)>0.009 then return jsonb_build_object('ok',false,'reason','amount_mismatch'); end if;
 update public.pdv_pix_intents set payment_status=st,mp_status_detail=_status_detail,paid_at=case when st='approved' then coalesce(paid_at,now()) else paid_at end,status=case when st='approved' then 'paid' when st in ('rejected','cancelled','canceled','refunded','charged_back') then 'failed' else status end,updated_at=now() where id=i.id;
 return jsonb_build_object('ok',true,'intent_id',i.id,'organization_id',i.organization_id,'amount',i.amount,'payment_status',st,'paid',st='approved');
end $$;

create or replace function public.pdv_pix_status_v2(_session_token text, _intent_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $$
declare s public.pdv_sessions%rowtype; i public.pdv_pix_intents%rowtype; h text;
begin
 h:=encode(extensions.digest(coalesce(_session_token,''),'sha256'),'hex');
 select * into s from public.pdv_sessions where token_hash=h and revoked_at is null and expires_at>now();
 if s.id is null then return jsonb_build_object('ok',false,'reason','invalid_session'); end if;
 select * into i from public.pdv_pix_intents where id=_intent_id and organization_id=s.organization_id and session_id=s.id;
 if i.id is null then return jsonb_build_object('ok',false,'reason','intent_not_found'); end if;
 update public.pdv_sessions set last_seen_at=now() where id=s.id;
 return jsonb_build_object('ok',true,'intent_id',i.id,'status',i.status,'payment_status',i.payment_status,'paid_at',i.paid_at,'amount',i.amount,'paid',i.status='paid');
end $$;

revoke all on function public.pdv_bind_pix_payment_internal(uuid,text) from public, anon, authenticated;
revoke all on function public.pdv_update_pix_payment_internal(text,text,text,numeric) from public, anon, authenticated;
revoke all on function public.pdv_pix_status_v2(text,uuid) from public;
grant execute on function public.pdv_pix_status_v2(text,uuid) to anon, authenticated;
