-- Phase 58: close search_path for driver workflow RPCs.
alter function public.confirm_delivery_with_code_session(text,uuid,text) set search_path='';
alter function public.entregador_available_orders_session(text) set search_path='';
alter function public.entregador_claim_order_session(text,uuid) set search_path='';
alter function public.entregador_orders_session(text) set search_path='';
alter function public.entregador_update_location_session(text,numeric,numeric,uuid) set search_path='';
