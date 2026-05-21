
-- Tabela de bairros / taxas de entrega
CREATE TABLE IF NOT EXISTS public.taxas_entrega (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  nome_bairro text NOT NULL,
  valor_taxa numeric NOT NULL DEFAULT 0,
  tempo_estimado integer NOT NULL DEFAULT 30,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_taxas_entrega_org ON public.taxas_entrega(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_taxas_entrega_org_nome
  ON public.taxas_entrega(organization_id, lower(nome_bairro));

ALTER TABLE public.taxas_entrega ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "taxas_entrega public read" ON public.taxas_entrega;
CREATE POLICY "taxas_entrega public read" ON public.taxas_entrega
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "taxas_entrega owner manage" ON public.taxas_entrega;
CREATE POLICY "taxas_entrega owner manage" ON public.taxas_entrega
  FOR ALL
  USING (
    is_super_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = taxas_entrega.organization_id
        AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  )
  WITH CHECK (
    is_super_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = taxas_entrega.organization_id
        AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

DROP TRIGGER IF EXISTS update_taxas_entrega_updated_at ON public.taxas_entrega;
CREATE TRIGGER update_taxas_entrega_updated_at
  BEFORE UPDATE ON public.taxas_entrega
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Novos campos no pedido para vincular bairro e taxa
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bairro_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bairro_nome text NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0;

-- Corrige o gatilho de código de entrega para aceitar "viagem" (frontend) e "delivery"
CREATE OR REPLACE FUNCTION public.set_delivery_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_tries int := 0;
BEGIN
  IF NEW.order_type IN ('delivery','viagem') AND COALESCE(NEW.delivery_code,'') = '' THEN
    LOOP
      v_code := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.orders
        WHERE organization_id = NEW.organization_id
          AND delivery_code = v_code
          AND status IN ('pending','preparing','out_for_delivery')
      ) OR v_tries > 12;
      v_tries := v_tries + 1;
    END LOOP;
    NEW.delivery_code := v_code;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_orders_delivery_code ON public.orders;
CREATE TRIGGER trg_orders_delivery_code
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_delivery_code();
