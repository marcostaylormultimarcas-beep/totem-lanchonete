alter table public.settings
  drop constraint if exists settings_delivery_mode_secure_check;

alter table public.settings
  add constraint settings_delivery_mode_secure_check
  check (delivery_mode is null or delivery_mode in ('bairros','lista_ceps'));
