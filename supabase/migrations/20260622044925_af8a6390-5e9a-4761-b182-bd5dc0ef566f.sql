
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS data_vencimento date,
  ADD COLUMN IF NOT EXISTS lote text,
  ADD COLUMN IF NOT EXISTS alerta_vencimento boolean NOT NULL DEFAULT false;

ALTER TABLE public.ingredientes
  ADD COLUMN IF NOT EXISTS data_vencimento date,
  ADD COLUMN IF NOT EXISTS lote text,
  ADD COLUMN IF NOT EXISTS alerta_vencimento boolean NOT NULL DEFAULT false;
