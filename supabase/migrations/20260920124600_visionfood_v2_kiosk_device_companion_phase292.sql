-- PHASE 292: commercial readiness — kiosk device enrollment + local companion durable queue foundation.
-- Branch-only migration. Do not apply remotely during this phase.
--
-- Security model:
-- - each kiosk has its own device_id and random credential;
-- - only SHA-256 hashes of device credentials are stored in Postgres;
-- - raw device credentials are generated/stored only by the local companion;
-- - browser/admin receives only short-lived one-time enrollment/rotation tokens;
-- - print-agent credentials remain separate and are not reused here;
-- - authoritative offline-order synchronization is intentionally deferred to PHASE 293.

create schema if not exists private;

create table if not exists private.kiosk_devices (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  credential_hash bytea,
  credential_version integer not null default 1,
  active boolean not null default true,
  last_seen_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kiosk_devices_label_length check (char_length(btrim(label)) between 1 and 80),
  constraint kiosk_devices_credential_version_positive check (credential_version > 0)
);

create unique index if not exists kiosk_devices_credential_hash_uidx
  on private.kiosk_devices(credential_hash)
  where credential_hash is not null;

create index if not exists kiosk_devices_org_idx
  on private.kiosk_devices(organization_id, active, label);

create table if not exists private.kiosk_device_enrollments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purpose text not null,
  target_device_id uuid references private.kiosk_devices(id) on delete cascade,
  label text not null,
  token_hash bytea not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_device_id uuid,
  claimed_credential_hash bytea,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint kiosk_device_enrollments_purpose_check check (purpose in ('enroll','rotate')),
  constraint kiosk_device_enrollments_target_check check (
    (purpose='enroll' and target_device_id is null)
    or (purpose='rotate' and target_device_id is not null)
  ),
  constraint kiosk_device_enrollments_label_length check (char_length(btrim(label)) between 1 and 80)
);

create unique index if not exists kiosk_device_enrollments_token_hash_uidx
  on private.kiosk_device_enrollments(token_hash);

create index if not exists kiosk_device_enrollments_org_idx
  on private.kiosk_device_enrollments(organization_id, expires_at desc);

alter table private.kiosk_devices enable row level security;
alter table private.kiosk_device_enrollments enable row level security;

revoke all on table private.kiosk_devices from public, anon, authenticated;
revoke all on table private.kiosk_device_enrollments from public, anon, authenticated;
grant all on table private.kiosk_devices to service_role;
grant all on table private.kiosk_device_enrollments to service_role;

create or replace function public.visionfood_kiosk_devices(_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  u uuid:=auth.uid();
  result jsonb;
begin
  if u is null or not private.usuario_dono_org(_org,u) then
    raise exception 'forbidden';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'device_id',d.id,
        'label',d.label,
        'active',d.active,
        'last_seen_at',d.last_seen_at,
        'credential_version',d.credential_version,
        'rotated_at',d.rotated_at,
        'revoked_at',d.revoked_at,
        'created_at',d.created_at,
        'updated_at',d.updated_at
      )
      order by d.label,d.created_at
    ),
    '[]'::jsonb
  )
  into result
  from private.kiosk_devices d
  where d.organization_id=_org;

  return result;
end
$function$;

revoke all on function public.visionfood_kiosk_devices(uuid) from public, anon, authenticated;
grant execute on function public.visionfood_kiosk_devices(uuid) to authenticated, service_role;

create or replace function public.visionfood_create_kiosk_enrollment(
  _org uuid,
  _label text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  u uuid:=auth.uid();
  normalized_label text:=btrim(coalesce(_label,''));
  raw_token text;
  token_hash bytea;
  expiry timestamptz:=now()+interval '15 minutes';
begin
  if u is null or not private.usuario_dono_org(_org,u) then
    raise exception 'forbidden';
  end if;
  if char_length(normalized_label)<1 or char_length(normalized_label)>80 then
    raise exception 'invalid_device_label';
  end if;

  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  token_hash:=extensions.digest(raw_token,'sha256');

  delete from private.kiosk_device_enrollments e
  where e.organization_id=_org
    and e.expires_at<now()-interval '1 day';

  insert into private.kiosk_device_enrollments(
    organization_id,purpose,target_device_id,label,token_hash,expires_at,created_by
  )
  values(_org,'enroll',null,normalized_label,token_hash,expiry,u);

  return jsonb_build_object(
    'ok',true,
    'purpose','enroll',
    'enrollment_token',raw_token,
    'expires_at',expiry
  );
end
$function$;

revoke all on function public.visionfood_create_kiosk_enrollment(uuid,text) from public, anon, authenticated;
grant execute on function public.visionfood_create_kiosk_enrollment(uuid,text) to authenticated, service_role;

create or replace function public.visionfood_create_kiosk_rotation(
  _org uuid,
  _device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  u uuid:=auth.uid();
  d private.kiosk_devices%rowtype;
  raw_token text;
  token_hash bytea;
  expiry timestamptz:=now()+interval '15 minutes';
begin
  if u is null or not private.usuario_dono_org(_org,u) then
    raise exception 'forbidden';
  end if;

  select *
    into d
  from private.kiosk_devices
  where id=_device_id and organization_id=_org
  for update;

  if not found then raise exception 'device_not_found'; end if;
  if d.revoked_at is not null then raise exception 'device_revoked'; end if;

  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  token_hash:=extensions.digest(raw_token,'sha256');

  insert into private.kiosk_device_enrollments(
    organization_id,purpose,target_device_id,label,token_hash,expires_at,created_by
  )
  values(_org,'rotate',d.id,d.label,token_hash,expiry,u);

  return jsonb_build_object(
    'ok',true,
    'purpose','rotate',
    'device_id',d.id,
    'enrollment_token',raw_token,
    'expires_at',expiry
  );
end
$function$;

revoke all on function public.visionfood_create_kiosk_rotation(uuid,uuid) from public, anon, authenticated;
grant execute on function public.visionfood_create_kiosk_rotation(uuid,uuid) to authenticated, service_role;

create or replace function public.visionfood_claim_kiosk_enrollment(
  _enrollment_token text,
  _device_id uuid,
  _credential_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  token_hash bytea;
  credential_hash bytea;
  e private.kiosk_device_enrollments%rowtype;
  d private.kiosk_devices%rowtype;
begin
  if _device_id is null
     or length(coalesce(_enrollment_token,''))<>64
     or coalesce(_credential_hash,'') !~ '^[0-9a-fA-F]{64}$' then
    return jsonb_build_object('ok',false,'reason','invalid_enrollment');
  end if;

  token_hash:=extensions.digest(_enrollment_token,'sha256');
  credential_hash:=decode(lower(_credential_hash),'hex');

  select *
    into e
  from private.kiosk_device_enrollments x
  where x.token_hash=token_hash
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','invalid_enrollment');
  end if;

  -- A claim already committed may be retried after a local crash, even if the
  -- enrollment window later expired, but only with the exact same device/hash.
  if e.claimed_at is not null then
    if e.claimed_device_id=_device_id
       and e.claimed_credential_hash=credential_hash then
      return jsonb_build_object(
        'ok',true,
        'idempotent',true,
        'device_id',e.claimed_device_id,
        'organization_id',e.organization_id
      );
    end if;
    return jsonb_build_object('ok',false,'reason','enrollment_already_claimed');
  end if;

  if e.expires_at<=now() then
    return jsonb_build_object('ok',false,'reason','invalid_enrollment');
  end if;

  if e.purpose='enroll' then
    if exists(select 1 from private.kiosk_devices x where x.id=_device_id) then
      return jsonb_build_object('ok',false,'reason','device_id_conflict');
    end if;

    insert into private.kiosk_devices(
      id,organization_id,label,credential_hash,active,last_seen_at
    )
    values(
      _device_id,e.organization_id,e.label,credential_hash,true,now()
    )
    returning * into d;
  else
    if e.target_device_id is distinct from _device_id then
      return jsonb_build_object('ok',false,'reason','device_mismatch');
    end if;

    update private.kiosk_devices x
       set credential_hash=credential_hash,
           credential_version=x.credential_version+1,
           rotated_at=now(),
           last_seen_at=now(),
           updated_at=now()
     where x.id=e.target_device_id
       and x.organization_id=e.organization_id
       and x.revoked_at is null
    returning x.* into d;

    if not found then
      return jsonb_build_object('ok',false,'reason','device_not_available');
    end if;
  end if;

  update private.kiosk_device_enrollments x
     set claimed_at=now(),
         claimed_device_id=d.id,
         claimed_credential_hash=credential_hash
   where x.id=e.id;

  return jsonb_build_object(
    'ok',true,
    'idempotent',false,
    'purpose',e.purpose,
    'device_id',d.id,
    'organization_id',d.organization_id,
    'credential_version',d.credential_version
  );
exception
  when unique_violation then
    return jsonb_build_object('ok',false,'reason','credential_conflict');
end
$function$;

revoke all on function public.visionfood_claim_kiosk_enrollment(text,uuid,text) from public;
grant execute on function public.visionfood_claim_kiosk_enrollment(text,uuid,text) to anon, authenticated, service_role;

create or replace function public.visionfood_set_kiosk_device_active(
  _org uuid,
  _device_id uuid,
  _active boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  u uuid:=auth.uid();
  d private.kiosk_devices%rowtype;
begin
  if u is null or not private.usuario_dono_org(_org,u) then
    raise exception 'forbidden';
  end if;

  select *
    into d
  from private.kiosk_devices
  where id=_device_id and organization_id=_org
  for update;

  if not found then raise exception 'device_not_found'; end if;
  if d.revoked_at is not null and coalesce(_active,false) then
    raise exception 'device_revoked';
  end if;

  update private.kiosk_devices
     set active=coalesce(_active,false),
         updated_at=now()
   where id=d.id
  returning * into d;

  return jsonb_build_object('ok',true,'device_id',d.id,'active',d.active);
end
$function$;

revoke all on function public.visionfood_set_kiosk_device_active(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.visionfood_set_kiosk_device_active(uuid,uuid,boolean) to authenticated, service_role;

create or replace function public.visionfood_revoke_kiosk_device(
  _org uuid,
  _device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  u uuid:=auth.uid();
  d private.kiosk_devices%rowtype;
begin
  if u is null or not private.usuario_dono_org(_org,u) then
    raise exception 'forbidden';
  end if;

  update private.kiosk_devices x
     set credential_hash=null,
         credential_version=x.credential_version+1,
         active=false,
         revoked_at=coalesce(x.revoked_at,now()),
         updated_at=now()
   where x.id=_device_id
     and x.organization_id=_org
  returning x.* into d;

  if not found then raise exception 'device_not_found'; end if;

  return jsonb_build_object('ok',true,'device_id',d.id,'revoked',true);
end
$function$;

revoke all on function public.visionfood_revoke_kiosk_device(uuid,uuid) from public, anon, authenticated;
grant execute on function public.visionfood_revoke_kiosk_device(uuid,uuid) to authenticated, service_role;

create or replace function public.visionfood_kiosk_device_heartbeat(
  _device_id uuid,
  _credential text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  d private.kiosk_devices%rowtype;
  h bytea;
begin
  if _device_id is null or length(coalesce(_credential,''))<32 then
    return jsonb_build_object('ok',false,'reason','invalid_device');
  end if;

  h:=extensions.digest(_credential,'sha256');

  update private.kiosk_devices x
     set last_seen_at=now(),
         updated_at=now()
   where x.id=_device_id
     and x.credential_hash=h
     and x.active=true
     and x.revoked_at is null
  returning x.* into d;

  if not found then
    return jsonb_build_object('ok',false,'reason','invalid_device');
  end if;

  return jsonb_build_object(
    'ok',true,
    'device_id',d.id,
    'organization_id',d.organization_id,
    'credential_version',d.credential_version,
    'last_seen_at',d.last_seen_at
  );
end
$function$;

revoke all on function public.visionfood_kiosk_device_heartbeat(uuid,text) from public;
grant execute on function public.visionfood_kiosk_device_heartbeat(uuid,text) to anon, authenticated, service_role;

-- PHASE 293 will introduce the authoritative sync contract.
-- Its idempotency key MUST be (device_id, client_request_id), with local_order_id retained
-- only as local durable-queue identity / diagnostics. No customer Supabase session is stored here.
