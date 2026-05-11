
-- 1. organizations table
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view organizations" ON public.organizations FOR SELECT USING (true);
CREATE POLICY "Anyone can insert organizations" ON public.organizations FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update organizations" ON public.organizations FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete organizations" ON public.organizations FOR DELETE USING (true);

CREATE TRIGGER update_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Seed default organization
INSERT INTO public.organizations (name, slug) VALUES ('Loja Principal', 'principal');

-- 3. Add organization_id to existing tables
ALTER TABLE public.admins ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.settings ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 4. Backfill all existing rows with the default org
UPDATE public.admins      SET organization_id = (SELECT id FROM public.organizations WHERE slug='principal') WHERE organization_id IS NULL;
UPDATE public.products    SET organization_id = (SELECT id FROM public.organizations WHERE slug='principal') WHERE organization_id IS NULL;
UPDATE public.orders      SET organization_id = (SELECT id FROM public.organizations WHERE slug='principal') WHERE organization_id IS NULL;
UPDATE public.settings    SET organization_id = (SELECT id FROM public.organizations WHERE slug='principal') WHERE organization_id IS NULL;

-- 5. Indexes
CREATE INDEX idx_admins_org   ON public.admins(organization_id);
CREATE INDEX idx_products_org ON public.products(organization_id);
CREATE INDEX idx_orders_org   ON public.orders(organization_id);
CREATE UNIQUE INDEX uniq_settings_org ON public.settings(organization_id);
