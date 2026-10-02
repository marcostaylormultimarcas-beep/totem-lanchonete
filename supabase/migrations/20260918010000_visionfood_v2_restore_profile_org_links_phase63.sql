-- Phase 63: restore profile-to-organization links required by auth and Clube de Vantagens.
alter table public.profiles add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.profiles add column if not exists origem_assinatura_empresa_id uuid references public.organizations(id) on delete set null;
create index if not exists idx_profiles_organization_id on public.profiles(organization_id);
create index if not exists idx_profiles_origem_assinatura_empresa_id on public.profiles(origem_assinatura_empresa_id);
