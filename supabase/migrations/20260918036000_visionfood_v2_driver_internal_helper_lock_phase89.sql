-- Phase 89: entregador_session_driver is an internal helper only.
-- Public/session-facing driver RPCs call it from SECURITY DEFINER context.
revoke all on function public.entregador_session_driver(text) from public,anon,authenticated;
grant execute on function public.entregador_session_driver(text) to service_role;
