ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS pay_cash_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pay_pix_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pay_card_terminal_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pay_card_online_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mp_terminal_id text NOT NULL DEFAULT '';