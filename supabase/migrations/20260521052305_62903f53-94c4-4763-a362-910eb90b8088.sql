
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT
    '{"mon":{"enabled":true,"windows":[["09:00","22:00"]]},"tue":{"enabled":true,"windows":[["09:00","22:00"]]},"wed":{"enabled":true,"windows":[["09:00","22:00"]]},"thu":{"enabled":true,"windows":[["09:00","22:00"]]},"fri":{"enabled":true,"windows":[["09:00","23:00"]]},"sat":{"enabled":true,"windows":[["11:00","23:00"]]},"sun":{"enabled":false,"windows":[]}}'::jsonb,
  ADD COLUMN IF NOT EXISTS emergency_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS closed_message text NOT NULL DEFAULT 'Lanchonete fechada no momento',
  ADD COLUMN IF NOT EXISTS scheduling_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
