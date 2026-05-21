ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS customer_cpf text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_orders_org_created ON public.orders(organization_id, created_at DESC);