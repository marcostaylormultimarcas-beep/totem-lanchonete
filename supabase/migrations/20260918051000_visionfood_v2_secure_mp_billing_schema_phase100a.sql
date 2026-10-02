create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.organization_payment_secrets (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  mp_access_token_secret_id uuid,
  mp_client_id_secret_id uuid,
  mp_public_key_secret_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists private.master_billing_secrets (
  id text primary key,
  mp_master_token_secret_id uuid,
  updated_at timestamptz not null default now()
);

revoke all on table private.organization_payment_secrets from public,anon,authenticated;
revoke all on table private.master_billing_secrets from public,anon,authenticated;
grant usage on schema private to service_role;
grant all on table private.organization_payment_secrets to service_role;
grant all on table private.master_billing_secrets to service_role;

alter table public.system_settings
  add column if not exists valor_plano_padrao numeric not null default 197.00,
  add column if not exists updated_at timestamptz not null default now();

alter table public.organizations
  add column if not exists mp_subscription_id text,
  add column if not exists mp_next_charge_at timestamptz,
  add column if not exists mp_subscription_amount numeric;

insert into public.system_settings(id) values('global') on conflict(id) do nothing;
insert into private.master_billing_secrets(id) values('global') on conflict(id) do nothing;
