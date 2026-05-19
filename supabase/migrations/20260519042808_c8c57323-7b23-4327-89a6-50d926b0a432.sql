ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS share_image text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pix_key_manual text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mp_access_token text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mp_public_key text NOT NULL DEFAULT '';