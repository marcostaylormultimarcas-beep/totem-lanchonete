CREATE TABLE public.loja_temas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE,
  primary_color text NOT NULL DEFAULT '25 95% 53%',
  secondary_color text NOT NULL DEFAULT '0 72% 51%',
  mode text NOT NULL DEFAULT 'dark' CHECK (mode IN ('dark','light')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.loja_temas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loja_temas public read"
  ON public.loja_temas FOR SELECT
  USING (true);

CREATE POLICY "loja_temas owner manage"
  ON public.loja_temas FOR ALL
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = loja_temas.organization_id
        AND (o.owner_id = auth.uid() OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = loja_temas.organization_id
        AND (o.owner_id = auth.uid() OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

CREATE TRIGGER loja_temas_updated_at
  BEFORE UPDATE ON public.loja_temas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();