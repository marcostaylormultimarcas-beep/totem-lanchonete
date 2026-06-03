CREATE TABLE public.senhas_chamadas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  numero text NOT NULL,
  tipo text NOT NULL DEFAULT 'normal',
  called_by uuid NULL,
  called_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_senhas_chamadas_org_called_at ON public.senhas_chamadas (organization_id, called_at DESC);

GRANT SELECT ON public.senhas_chamadas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.senhas_chamadas TO authenticated;
GRANT ALL ON public.senhas_chamadas TO service_role;

ALTER TABLE public.senhas_chamadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "senhas public read"
  ON public.senhas_chamadas FOR SELECT
  USING (true);

CREATE POLICY "senhas owner manage"
  ON public.senhas_chamadas FOR ALL
  USING (
    is_super_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = senhas_chamadas.organization_id
        AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  )
  WITH CHECK (
    is_super_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = senhas_chamadas.organization_id
        AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

ALTER TABLE public.senhas_chamadas REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.senhas_chamadas;