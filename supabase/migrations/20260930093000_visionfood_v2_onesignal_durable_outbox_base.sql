-- Durable Outbox V2 foundation.
--
-- This migration is intentionally additive only:
--   * it does not change visionfood_onesignal_queue;
--   * it does not change set_onesignal_config;
--   * it does not submit any pg_net request;
--   * it establishes durable state needed to replace transport-table inference
--     incrementally in later blocks.
--
-- Credential generations are immutable snapshots. A future rotation migration
-- will insert a new generation and point new outbox rows at it instead of
-- mutating the credential used by older non-terminal rows.

create table if not exists private.onesignal_config_generations (
  id uuid primary key default gen_random_uuid(),
  app_id text not null,
  api_key_secret_id uuid not null,
  created_at timestamptz not null default now(),

  constraint onesignal_config_generations_app_id_chk
    check (
      app_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),

  constraint onesignal_config_generations_id_app_key
    unique (id,app_id)
);

revoke all on table private.onesignal_config_generations
  from public,anon,authenticated;

grant select,insert,delete
  on table private.onesignal_config_generations
  to service_role;

create table if not exists private.onesignal_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,

  push_type text not null,
  source_kind text not null,
  source_key text not null,

  config_generation_id uuid not null,
  app_id text not null,

  audience jsonb not null,
  payload jsonb not null,
  idempotency_key uuid not null,

  status text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),

  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,

  last_request_id bigint,
  last_attempt_at timestamptz,
  last_http_status integer,
  last_error text,
  last_response_body text,
  onesignal_notification_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_sending_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,

  constraint onesignal_outbox_config_generation_fk
    foreign key (config_generation_id,app_id)
    references private.onesignal_config_generations(id,app_id)
    on delete restrict,

  constraint onesignal_outbox_push_type_chk
    check (btrim(push_type)<>''),

  constraint onesignal_outbox_source_kind_chk
    check (btrim(source_kind)<>''),

  constraint onesignal_outbox_source_key_chk
    check (btrim(source_key)<>''),

  constraint onesignal_outbox_app_id_chk
    check (
      app_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),

  constraint onesignal_outbox_audience_chk
    check (
      jsonb_typeof(audience)='object'
      and audience<>'{}'::jsonb
    ),

  constraint onesignal_outbox_payload_chk
    check (
      jsonb_typeof(payload)='object'
      and payload->>'app_id'=app_id
      and payload->>'idempotency_key'=idempotency_key::text
      and payload #>> '{data,organization_id}'=organization_id::text
      and payload @> audience
    ),

  constraint onesignal_outbox_status_chk
    check (status in ('pending','sending','delivered','retry','failed')),

  constraint onesignal_outbox_attempt_count_chk
    check (attempt_count>=0),

  constraint onesignal_outbox_request_id_chk
    check (last_request_id is null or last_request_id>0),

  constraint onesignal_outbox_http_status_chk
    check (
      last_http_status is null
      or last_http_status between 100 and 599
    ),

  constraint onesignal_outbox_lease_chk
    check (
      (
        status='sending'
        and lease_token is not null
        and nullif(btrim(coalesce(lease_owner,'')),'') is not null
        and lease_expires_at is not null
      )
      or
      (
        status<>'sending'
        and lease_token is null
        and lease_owner is null
        and lease_expires_at is null
      )
    ),

  constraint onesignal_outbox_delivered_chk
    check (
      (
        status='delivered'
        and delivered_at is not null
        and nullif(btrim(coalesce(onesignal_notification_id,'')),'') is not null
      )
      or
      (
        status<>'delivered'
        and delivered_at is null
      )
    ),

  constraint onesignal_outbox_failed_chk
    check (
      (
        status='failed'
        and failed_at is not null
      )
      or
      (
        status<>'failed'
        and failed_at is null
      )
    )
);

create unique index if not exists onesignal_outbox_idempotency_key_uidx
  on private.onesignal_outbox(idempotency_key);

create index if not exists onesignal_outbox_claim_idx
  on private.onesignal_outbox(status,available_at,created_at)
  where status in ('pending','retry');

create index if not exists onesignal_outbox_expired_lease_idx
  on private.onesignal_outbox(lease_expires_at,created_at)
  where status='sending';

create index if not exists onesignal_outbox_org_created_idx
  on private.onesignal_outbox(organization_id,created_at desc);

revoke all on table private.onesignal_outbox
  from public,anon,authenticated;

grant select,insert,update,delete
  on table private.onesignal_outbox
  to service_role;

create table if not exists private.onesignal_outbox_attempts (
  id bigint generated always as identity primary key,
  outbox_id uuid not null
    references private.onesignal_outbox(id)
    on delete cascade,

  attempt_no integer not null,
  lease_token uuid not null,
  pg_net_request_id bigint,

  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  result_observed_at timestamptz,

  http_status integer,
  timed_out boolean,
  error_text text,
  response_body text,
  semantic_outcome text,
  onesignal_notification_id text,

  constraint onesignal_outbox_attempts_attempt_no_chk
    check (attempt_no>0),

  constraint onesignal_outbox_attempts_request_id_chk
    check (pg_net_request_id is null or pg_net_request_id>0),

  constraint onesignal_outbox_attempts_http_status_chk
    check (
      http_status is null
      or http_status between 100 and 599
    ),

  constraint onesignal_outbox_attempts_semantic_outcome_chk
    check (
      semantic_outcome is null
      or semantic_outcome in ('delivered','retry','failed')
    ),

  constraint onesignal_outbox_attempts_outbox_attempt_key
    unique (outbox_id,attempt_no)
);

-- request_id is transport metadata, never the durable identity. Keep it
-- searchable but not globally unique: if pg_net ever reuses an id, later
-- reconciliation must treat multiple matches as ambiguous instead of binding
-- the response to the wrong logical push.
create index if not exists onesignal_outbox_attempts_request_idx
  on private.onesignal_outbox_attempts(pg_net_request_id)
  where pg_net_request_id is not null;

create index if not exists onesignal_outbox_attempts_outbox_created_idx
  on private.onesignal_outbox_attempts(outbox_id,created_at desc);

revoke all on table private.onesignal_outbox_attempts
  from public,anon,authenticated;

grant select,insert,update,delete
  on table private.onesignal_outbox_attempts
  to service_role;
