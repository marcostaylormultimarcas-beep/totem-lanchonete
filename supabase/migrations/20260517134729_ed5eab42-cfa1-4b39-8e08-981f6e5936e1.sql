
CREATE TABLE public.config_fidelidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT false,
  meta_pedidos integer NOT NULL DEFAULT 10,
  valor_minimo_pedido numeric NOT NULL DEFAULT 30,
  premio_recompensa text NOT NULL DEFAULT 'Ganhe um brinde especial',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.config_fidelidade ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read config_fidelidade"
ON public.config_fidelidade FOR SELECT USING (true);

CREATE POLICY "config_fidelidade manage"
ON public.config_fidelidade FOR ALL
USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = config_fidelidade.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
)
WITH CHECK (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = config_fidelidade.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

CREATE TRIGGER trg_config_fidelidade_updated
BEFORE UPDATE ON public.config_fidelidade
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.progresso_fidelidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  telefone_cliente text NOT NULL,
  quantidade_carimbos integer NOT NULL DEFAULT 0,
  premios_resgatados integer NOT NULL DEFAULT 0,
  ultimo_pedido_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, telefone_cliente)
);

CREATE INDEX idx_progresso_fid_phone ON public.progresso_fidelidade(organization_id, telefone_cliente);

ALTER TABLE public.progresso_fidelidade ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read progresso_fidelidade"
ON public.progresso_fidelidade FOR SELECT USING (true);

CREATE POLICY "Public insert progresso_fidelidade"
ON public.progresso_fidelidade FOR INSERT WITH CHECK (true);

CREATE POLICY "Public update progresso_fidelidade"
ON public.progresso_fidelidade FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "progresso_fidelidade owner manage"
ON public.progresso_fidelidade FOR ALL
USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = progresso_fidelidade.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
)
WITH CHECK (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = progresso_fidelidade.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

CREATE TRIGGER trg_progresso_fidelidade_updated
BEFORE UPDATE ON public.progresso_fidelidade
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
