-- Phase 49: only the session-issuing driver login is a client API.
revoke execute on function public.entregador_login(text,text,text) from public, anon, authenticated;
comment on function public.entregador_login(text,text,text) is 'Internal credential verifier; client entrypoint is entregador_login_session.';
