
-- 1) logs_impressao
CREATE TABLE IF NOT EXISTS public.logs_impressao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid,
  status text NOT NULL DEFAULT 'info',
  message text NOT NULL DEFAULT '',
  printer_ip text NOT NULL DEFAULT '',
  payload_size integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_impressao_org_created
  ON public.logs_impressao (organization_id, created_at DESC);
ALTER TABLE public.logs_impressao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "logs_impressao owner read" ON public.logs_impressao;
CREATE POLICY "logs_impressao owner read" ON public.logs_impressao
  FOR SELECT USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = logs_impressao.organization_id
        AND (o.owner_id = auth.uid() OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

DROP POLICY IF EXISTS "logs_impressao owner insert" ON public.logs_impressao;
CREATE POLICY "logs_impressao owner insert" ON public.logs_impressao
  FOR INSERT WITH CHECK (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = logs_impressao.organization_id
        AND (o.owner_id = auth.uid() OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

-- 2) configuracoes_impressao: webhook
ALTER TABLE public.configuracoes_impressao
  ADD COLUMN IF NOT EXISTS webhook_alerta_url text NOT NULL DEFAULT '';

-- 3) settings: taxa_vision_percent
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS taxa_vision_percent numeric NOT NULL DEFAULT 0;

-- 4) Trigger de impressão honrando auto_print
CREATE OR REPLACE FUNCTION public.queue_order_for_printing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.configuracoes_impressao%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('preparing','ready','out_for_delivery','delivered') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.print_status,'pending') NOT IN ('pending','manual_pending') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_cfg FROM public.configuracoes_impressao
    WHERE organization_id = NEW.organization_id LIMIT 1;

  IF NOT FOUND OR NOT v_cfg.enabled THEN
    RETURN NEW;
  END IF;

  IF v_cfg.auto_print THEN
    NEW.print_status := 'queued';
  ELSE
    NEW.print_status := 'manual_pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_order_print ON public.orders;
CREATE TRIGGER trg_queue_order_print
  BEFORE INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.queue_order_for_printing();

-- 5) View financeira detalhada
CREATE OR REPLACE VIEW public.v_financeiro_detalhado AS
SELECT
  o.id                       AS order_id,
  o.organization_id,
  o.order_number,
  o.created_at,
  o.status,
  o.payment_method,
  o.customer_name,
  o.total                    AS valor_bruto,
  CASE o.payment_method
    WHEN 'pix'      THEN ROUND(o.total * 0.0099, 2)
    WHEN 'online'   THEN ROUND(o.total * 0.0499, 2)
    WHEN 'terminal' THEN ROUND(o.total * 0.0199, 2)
    ELSE 0
  END                        AS taxa_gateway_valor,
  ROUND(o.total * COALESCE(s.taxa_vision_percent, 0) / 100.0, 2) AS taxa_vision_valor,
  ROUND(
    o.total
    - CASE o.payment_method
        WHEN 'pix'      THEN o.total * 0.0099
        WHEN 'online'   THEN o.total * 0.0499
        WHEN 'terminal' THEN o.total * 0.0199
        ELSE 0
      END
    - (o.total * COALESCE(s.taxa_vision_percent, 0) / 100.0)
  , 2)                       AS valor_liquido_final
FROM public.orders o
LEFT JOIN public.settings s ON s.organization_id = o.organization_id
WHERE o.status <> 'cancelled';

GRANT SELECT ON public.v_financeiro_detalhado TO authenticated, anon;
