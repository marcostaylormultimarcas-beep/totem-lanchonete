CREATE TABLE public.cupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('porcentagem','valor_fixo')),
  valor numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, codigo)
);

ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read cupons"
ON public.cupons FOR SELECT
USING (true);

CREATE POLICY "Owner inserts cupons"
ON public.cupons FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'master'::app_role) OR
  EXISTS (SELECT 1 FROM organizations o WHERE o.id = cupons.organization_id AND o.owner_id = auth.uid())
);

CREATE POLICY "Owner updates cupons"
ON public.cupons FOR UPDATE
USING (
  has_role(auth.uid(), 'master'::app_role) OR
  EXISTS (SELECT 1 FROM organizations o WHERE o.id = cupons.organization_id AND o.owner_id = auth.uid())
);

CREATE POLICY "Owner deletes cupons"
ON public.cupons FOR DELETE
USING (
  has_role(auth.uid(), 'master'::app_role) OR
  EXISTS (SELECT 1 FROM organizations o WHERE o.id = cupons.organization_id AND o.owner_id = auth.uid())
);

CREATE TRIGGER update_cupons_updated_at
BEFORE UPDATE ON public.cupons
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_cupons_org_codigo ON public.cupons(organization_id, codigo);