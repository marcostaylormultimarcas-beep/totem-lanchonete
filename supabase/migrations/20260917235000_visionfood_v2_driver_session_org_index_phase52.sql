-- Phase 52: cover entregador_sessions.organization_id foreign key.
create index if not exists idx_entregador_sessions_organization_id
  on public.entregador_sessions(organization_id);
