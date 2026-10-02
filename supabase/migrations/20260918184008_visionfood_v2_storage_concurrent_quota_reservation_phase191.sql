create table if not exists private.storage_quota_locks (
  organization_id uuid primary key,
  updated_at timestamptz not null default now()
);

create table if not exists private.storage_upload_reservations (
  organization_id uuid not null,
  bucket_id text not null,
  name text not null,
  user_id uuid not null,
  expected_size bigint not null
    check (expected_size > 0 and expected_size <= 26214400),
  previous_size bigint not null default 0
    check (previous_size >= 0),
  reserved_delta bigint not null default 0
    check (reserved_delta >= 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (bucket_id,name)
);

create index if not exists idx_storage_upload_reservations_org_expiry
on private.storage_upload_reservations(organization_id,expires_at);

revoke all on table private.storage_quota_locks
from public,anon,authenticated,service_role;

revoke all on table private.storage_upload_reservations
from public,anon,authenticated,service_role;

grant usage on schema private to authenticated;

create or replace function private.visionfood_storage_quota_reserve(
  _bucket_id text,
  _name text,
  _metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_allowed_buckets constant text[] :=
    array['produtos','totem-images','products','categories','covers'];
  v_limit constant bigint := 262144000;
  v_file_limit constant bigint := 26214400;
  v_folder text;
  v_org uuid;
  v_uid uuid;
  v_new_size bigint;
  v_current_size bigint := 0;
  v_used bigint := 0;
  v_reserved bigint := 0;
  v_delta bigint := 0;
  v_existing private.storage_upload_reservations%rowtype;
begin
  if _bucket_id is null
     or _bucket_id <> all(v_allowed_buckets)
     or _name is null
     or _metadata is null
  then
    return false;
  end if;

  if not public.visionfood_storage_org_path_allowed(_name) then
    return false;
  end if;

  v_folder := (storage.foldername(_name))[1];
  v_uid := (select auth.uid());

  if v_uid is null
     or v_folder is null
     or v_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  v_org := v_folder::uuid;

  if coalesce(_metadata->>'contentLength','') ~ '^[0-9]+$' then
    v_new_size := (_metadata->>'contentLength')::bigint;
  elsif coalesce(_metadata->>'size','') ~ '^[0-9]+$' then
    v_new_size := (_metadata->>'size')::bigint;
  else
    return false;
  end if;

  if v_new_size <= 0 or v_new_size > v_file_limit then
    return false;
  end if;

  insert into private.storage_quota_locks(organization_id,updated_at)
  values(v_org,now())
  on conflict(organization_id) do update
    set updated_at=excluded.updated_at;

  delete from private.storage_upload_reservations r
  where r.organization_id=v_org
    and (
      r.expires_at<=now()
      or exists (
        select 1
        from storage.objects o
        where o.bucket_id=r.bucket_id
          and o.name=r.name
          and (
            case
              when coalesce(o.metadata->>'size','') ~ '^[0-9]+$'
                then (o.metadata->>'size')::bigint
              when coalesce(o.metadata->>'contentLength','') ~ '^[0-9]+$'
                then (o.metadata->>'contentLength')::bigint
              else -1
            end
          )=r.expected_size
      )
    );

  select *
  into v_existing
  from private.storage_upload_reservations r
  where r.bucket_id=_bucket_id
    and r.name=_name
  limit 1;

  if found then
    if v_existing.organization_id=v_org
       and v_existing.user_id=v_uid
       and v_existing.expected_size=v_new_size
       and v_existing.expires_at>now()
    then
      return true;
    end if;
    return false;
  end if;

  select coalesce(max(
    case
      when coalesce(o.metadata->>'size','') ~ '^[0-9]+$'
        then (o.metadata->>'size')::bigint
      when coalesce(o.metadata->>'contentLength','') ~ '^[0-9]+$'
        then (o.metadata->>'contentLength')::bigint
      else 0
    end
  ),0)::bigint
  into v_current_size
  from storage.objects o
  where o.bucket_id=_bucket_id
    and o.name=_name;

  select coalesce(sum(
    case
      when coalesce(o.metadata->>'size','') ~ '^[0-9]+$'
        then (o.metadata->>'size')::bigint
      when coalesce(o.metadata->>'contentLength','') ~ '^[0-9]+$'
        then (o.metadata->>'contentLength')::bigint
      else 0
    end
  ),0)::bigint
  into v_used
  from storage.objects o
  where o.bucket_id=any(v_allowed_buckets)
    and (storage.foldername(o.name))[1]=v_folder;

  select coalesce(sum(r.reserved_delta),0)::bigint
  into v_reserved
  from private.storage_upload_reservations r
  where r.organization_id=v_org
    and r.expires_at>now();

  v_delta := greatest(v_new_size-v_current_size,0);

  if v_used + v_reserved + v_delta > v_limit then
    return false;
  end if;

  insert into private.storage_upload_reservations(
    organization_id,bucket_id,name,user_id,
    expected_size,previous_size,reserved_delta,
    expires_at,updated_at
  )
  values(
    v_org,_bucket_id,_name,v_uid,
    v_new_size,v_current_size,v_delta,
    now()+interval '10 minutes',now()
  );

  return true;
exception
  when invalid_text_representation
    or numeric_value_out_of_range
    or check_violation
  then
    return false;
end
$$;

revoke all on function private.visionfood_storage_quota_reserve(text,text,jsonb)
from public,anon,service_role;

grant execute on function private.visionfood_storage_quota_reserve(text,text,jsonb)
to authenticated;

drop function if exists public.visionfood_storage_quota_allowed(text,text,jsonb);

drop policy if exists "VisionFood authenticated tenant image insert"
on storage.objects;

create policy "VisionFood authenticated tenant image insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = any(array['produtos','totem-images','products','categories','covers'])
  and public.visionfood_storage_org_path_allowed(name)
  and private.visionfood_storage_quota_reserve(bucket_id,name,metadata)
);

drop policy if exists "VisionFood authenticated tenant image update"
on storage.objects;

create policy "VisionFood authenticated tenant image update"
on storage.objects
for update
to authenticated
using (
  bucket_id = any(array['produtos','totem-images','products','categories','covers'])
  and public.visionfood_storage_org_path_allowed(name)
)
with check (
  bucket_id = any(array['produtos','totem-images','products','categories','covers'])
  and public.visionfood_storage_org_path_allowed(name)
  and private.visionfood_storage_quota_reserve(bucket_id,name,metadata)
);
