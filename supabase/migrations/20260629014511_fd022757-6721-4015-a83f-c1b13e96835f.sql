
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS delivery_pedido_minimo numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_horario_inicio text,
  ADD COLUMN IF NOT EXISTS delivery_horario_fim text;
