-- VisionFood V2 — align delivery schema required by token driver flow (phase 38)
-- Additive only. Designed from the verified production schema.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS entregador_id uuid REFERENCES public.entregadores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_code text;

CREATE INDEX IF NOT EXISTS idx_orders_entregador_id ON public.orders(entregador_id);
CREATE INDEX IF NOT EXISTS idx_orders_org_entregador_status
  ON public.orders(organization_id, entregador_id, status, created_at DESC);

-- Code is nullable for non-delivery/legacy orders, but if present must be exactly four digits.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_delivery_code_format_check'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_delivery_code_format_check
      CHECK (delivery_code IS NULL OR delivery_code ~ '^[0-9]{4}$');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.entregas_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entregador_id uuid NOT NULL REFERENCES public.entregadores(id) ON DELETE RESTRICT,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS entregas_log_order_unique ON public.entregas_log(order_id);
CREATE INDEX IF NOT EXISTS idx_entregas_log_org_delivered ON public.entregas_log(organization_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_entregas_log_entregador ON public.entregas_log(entregador_id, delivered_at DESC);

ALTER TABLE public.entregas_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.entregas_log FROM anon, authenticated;

-- Generate a delivery confirmation code server-side when a delivery order is created
-- without one. The code is never trusted as authentication by itself: confirmation RPC
-- also validates the revocable driver session, organization and assignment.
CREATE OR REPLACE FUNCTION public.visionfood_set_delivery_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.order_type IN ('delivery','viagem') AND NEW.delivery_code IS NULL THEN
    NEW.delivery_code := lpad((floor(random() * 10000))::int::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_visionfood_set_delivery_code ON public.orders;
CREATE TRIGGER trg_visionfood_set_delivery_code
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.visionfood_set_delivery_code();
