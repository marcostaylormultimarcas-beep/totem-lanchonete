
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sold_by_weight boolean NOT NULL DEFAULT false;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS balanca_modelo text NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS balanca_baud_rate integer NOT NULL DEFAULT 9600;
