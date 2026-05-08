ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ingredients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''::text;