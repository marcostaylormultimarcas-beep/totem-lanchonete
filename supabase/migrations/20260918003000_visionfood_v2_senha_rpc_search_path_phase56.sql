-- Phase 56: harden privileged senha RPC search paths.
alter function public.chamar_proxima_senha(uuid,text,text) set search_path='';
alter function public.reset_senha_counter(uuid,text) set search_path='';
