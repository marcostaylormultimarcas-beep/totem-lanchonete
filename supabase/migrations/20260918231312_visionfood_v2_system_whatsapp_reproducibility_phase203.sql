alter table public.system_settings
  add column if not exists whatsapp_suporte text not null default '';
