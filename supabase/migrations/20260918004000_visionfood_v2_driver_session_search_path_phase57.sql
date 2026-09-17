-- Phase 57: harden driver session entrypoints.
-- Crypto calls are schema-qualified before closing search_path.
alter function public.entregador_login_session(text,text,text) set search_path='';
alter function public.entregador_session_driver(text) set search_path='';
alter function public.entregador_logout_session(text) set search_path='';
-- Installed function bodies use extensions.gen_random_bytes / extensions.digest.
