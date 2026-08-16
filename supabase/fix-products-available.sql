-- Rode este script no SQL Editor do seu Supabase externo (projeto udhcnpauymevkylldkir)
-- Corrige o erro PGRST204: "Could not find the 'available' column of 'products'".

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS available boolean NOT NULL DEFAULT true;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS manage_stock boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_quantity numeric NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS low_stock_threshold numeric NOT NULL DEFAULT 5;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sold_by_weight boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS codigo_barras text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS data_vencimento date;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS lote text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS alerta_vencimento boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS prep_time_min numeric NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ingredients jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT ON public.products TO anon;
GRANT ALL ON public.products TO service_role;

-- Recarrega o cache de schema do PostgREST (evita PGRST204 residual)
NOTIFY pgrst, 'reload schema';
