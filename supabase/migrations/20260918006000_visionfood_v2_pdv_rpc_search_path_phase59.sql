-- Phase 59: close search_path on public PDV V2/session RPCs after verifying schema-qualified dependencies.
alter function public.pdv_abrir_caixa_v2(text,numeric) set search_path='';
alter function public.pdv_buscar_pedido_v2(text,text) set search_path='';
alter function public.pdv_caixa_resumo_v2(text,uuid) set search_path='';
alter function public.pdv_catalog_v2(text) set search_path='';
alter function public.pdv_create_pix_intent_v2(text,uuid,jsonb,text) set search_path='';
alter function public.pdv_create_session(text,text,text) set search_path='';
alter function public.pdv_devolver_pedido_v2(text,uuid,uuid,jsonb,numeric,text) set search_path='';
alter function public.pdv_fechar_caixa_v2(text,uuid) set search_path='';
alter function public.pdv_pix_status_v2(text,uuid) set search_path='';
alter function public.pdv_registrar_movimento_v2(text,uuid,text,text,numeric,text) set search_path='';
alter function public.pdv_registrar_venda_pix_v2(text,uuid) set search_path='';
alter function public.pdv_registrar_venda_v2(text,uuid,jsonb,text,numeric,text,numeric) set search_path='';
alter function public.pdv_revoke_session(text) set search_path='';
alter function public.pdv_session_context(text) set search_path='';
alter function public.pdv_set_order_customer_phone_v2(text,uuid,text) set search_path='';
alter function public.pdv_validar_cupom_v2(text,text) set search_path='';
