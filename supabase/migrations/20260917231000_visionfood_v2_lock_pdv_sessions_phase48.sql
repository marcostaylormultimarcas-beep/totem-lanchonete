-- Phase 48: PDV sessions are RPC-only. No client role needs direct table access.
revoke all on table public.pdv_sessions from anon, authenticated;
