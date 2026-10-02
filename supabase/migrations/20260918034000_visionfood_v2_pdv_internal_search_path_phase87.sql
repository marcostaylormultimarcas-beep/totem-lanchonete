-- Phase 87: harden inspected PDV internal SECURITY DEFINER functions.
-- Their relation/function references are explicitly schema-qualified.
alter function public.pdv_abrir_caixa_session(text,numeric) set search_path='';
alter function public.pdv_bind_pix_payment_internal(uuid,text) set search_path='';
alter function public.pdv_claim_pix_intent_internal(uuid,text) set search_path='';
alter function public.pdv_fechar_caixa_session(text,uuid) set search_path='';
alter function public.pdv_operador_login(text,text,text) set search_path='';
alter function public.pdv_registrar_movimento_session(text,uuid,text,text,numeric,text) set search_path='';
alter function public.pdv_update_pix_payment_internal(text,text,text,numeric) set search_path='';
