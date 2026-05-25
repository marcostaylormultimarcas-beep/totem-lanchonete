
CREATE TABLE IF NOT EXISTS public.system_settings (
  id text PRIMARY KEY DEFAULT 'global',
  onesignal_app_id text NOT NULL DEFAULT '',
  onesignal_api_key text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_settings super manage"
ON public.system_settings
FOR ALL
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "system_settings authenticated read app_id"
ON public.system_settings
FOR SELECT
TO authenticated
USING (true);

INSERT INTO public.system_settings (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;
