-- Durable Outbox V2 foundation.
--
-- Schema only: this migration does not switch any producer, dispatcher,
-- retry/result RPC, configuration rotation, or pg_net behavior. The current
-- OneSignal path remains authoritative until later cutover migrations.
--
-- The outbox row is the durable identity of one logical OneSignal request.
-- app_id, config_generation, audience, payload and idempotency_key are intended
-- to be frozen once inserted. A later migration will bind config_generation to
-- an immutable credential-generation ledger and wire claim/dispatch/reconcile.
--
-- Transport attempts are kept separately so a late pg_net response from an
-- older request_id cannot be confused with or overwrite a newer retry.

create table if not exists private.onesignal_push_outbox (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  origin text not null,
  app_id text not null,
  config_generation bigint not null,
  audience jsonb not null,
  payload jsonb not null,
  idempotency_key uuid not null,

  status text not null default 'pending',
  attempts integer not null default 0,
  request_id bigint,
  next_attempt_at timestamptz not null default now(),

  lease_token uuid,
  lease_expires_at timestamptz,

  last_http_status integer,
  last_error text,
  last_response_body text,
  onesignal_notification_id text,

  first_enqueued_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint onesignal_push_outbox_origin_chk
    check (btrim(origin) <> ''),
  constraint onesignal_push_outbox_app_id_chk
    check (
      app_id=btrim(app_id)
      and app_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  constraint onesignal_push_outbox_config_generation_chk
    check (config_generation > 0),
  constraint onesignal_push_outbox_audience_chk
    check (pg_catalog.jsonb_typeof(audience)='object'),
  constraint onesignal_push_outbox_payload_chk
    check (pg_catalog.jsonb_typeof(payload)='object'),
  constraint onesignal_push_outbox_status_chk
    check (status in ('pending','sending','delivered','retry','failed')),
  constraint onesignal_push_outbox_attempts_chk
    check (attempts >= 0),
  constraint onesignal_push_outbox_lease_chk
    check (
      (
        status='sending'
        and lease_token is not null
        and lease_expires_at is not null
      )
      or
      (
        status<>'sending'
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  constraint onesignal_push_outbox_idempotency_key_uniq
    unique (idempotency_key)
);

create index if not exists onesignal_push_outbox_dispatch_idx
  on private.onesignal_push_outbox(next_attempt_at,created_at)
  where status in ('pending','retry');

create index if not exists onesignal_push_outbox_sending_lease_idx
  on private.onesignal_push_outbox(lease_expires_at)
  where status='sending';

create index if not exists onesignal_push_outbox_generation_open_idx
  on private.onesignal_push_outbox(config_generation,status)
  where status in ('pending','sending','retry');

create index if not exists onesignal_push_outbox_org_created_idx
  on private.onesignal_push_outbox(organization_id,created_at desc);

create table if not exists private.onesignal_push_outbox_attempts (
  outbox_id uuid not null
    references private.onesignal_push_outbox(id)
    on delete cascade,
  attempt_no integer not null,
  lease_token uuid not null,
  request_id bigint,

  outcome text not null default 'queued',
  enqueued_at timestamptz not null default now(),
  result_observed_at timestamptz,

  http_status integer,
  timed_out boolean,
  error_msg text,
  response_body text,
  onesignal_notification_id text,

  primary key (outbox_id,attempt_no),

  constraint onesignal_push_outbox_attempt_no_chk
    check (attempt_no > 0),
  constraint onesignal_push_outbox_attempt_outcome_chk
    check (outcome in ('queued','delivered','retry','failed','ambiguous'))
);

-- request_id is transport metadata, not the durable identity. Keep it indexed
-- for result lookup, but deliberately do not make it globally unique: a pg_net
-- sequence reset/reuse must never be allowed to redefine outbox identity.
create index if not exists onesignal_push_outbox_attempt_request_idx
  on private.onesignal_push_outbox_attempts(request_id)
  where request_id is not null;

create index if not exists onesignal_push_outbox_attempt_outbox_created_idx
  on private.onesignal_push_outbox_attempts(outbox_id,enqueued_at desc);

revoke all on table private.onesignal_push_outbox
  from public,anon,authenticated;

revoke all on table private.onesignal_push_outbox_attempts
  from public,anon,authenticated;

grant select,insert,update,delete
  on table private.onesignal_push_outbox
  to service_role;

grant select,insert,update,delete
  on table private.onesignal_push_outbox_attempts
  to service_role;
