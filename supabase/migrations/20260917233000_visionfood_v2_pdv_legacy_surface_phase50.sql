-- Phase 50: remove obsolete PDV RPC entrypoints after v2 session cutover.
revoke execute on function public.pdv_abrir_caixa_session(text,numeric) from public, anon, authenticated;
revoke execute on function public.pdv_fechar_caixa_session(text,uuid) from public, anon, authenticated;
revoke execute on function public.pdv_registrar_movimento_session(text,uuid,text,text,numeric,text) from public, anon, authenticated;
revoke execute on function public.pdv_operador_login(text,text,text) from public, anon, authenticated;
