
-- Clube de Vantagens: categoria + logo da loja, origem do cliente
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'outro',
  ADD COLUMN IF NOT EXISTS logo_url text NOT NULL DEFAULT '';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS origem_assinatura_empresa_id uuid;

CREATE INDEX IF NOT EXISTS idx_profiles_origem ON public.profiles(origem_assinatura_empresa_id);
CREATE INDEX IF NOT EXISTS idx_orgs_categoria ON public.organizations(categoria);
