ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS categories jsonb NOT NULL DEFAULT '[
    {"key":"hamburgueres","label":"Hambúrgueres","icon":"🍔"},
    {"key":"pizzas","label":"Pizzas","icon":"🍕"},
    {"key":"bebidas","label":"Bebidas","icon":"🥤"}
  ]'::jsonb;