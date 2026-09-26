create or replace function public.visionfood_storage_quota_allowed(
  _bucket_id text,
  _name text,
  _metadata jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_folder text;
  v_new_size bigint;
  v_existing_size bigint;
  v_limit constant bigint := 262144000; -- 250 MiB por organização
begin
  if _bucket_id is null
     or _bucket_id <> all(array['produtos','totem-images','products','categories','covers'])
  then
    return false;
  end if;

  if not public.visionfood_storage_org_path_allowed(_name) then
    return false;
  end if;

  v_folder := (storage.foldername(_name))[1];

  v_new_size := coalesce(
    nullif(_metadata->>'contentLength','')::bigint,
    nullif(_metadata->>'size','')::bigint
  );

  if v_new_size is null
     or v_new_size <= 0
     or v_new_size > 26214400
  then
    return false;
  end if;

  select coalesce(sum(
    case
      when coalesce(o.metadata->>'size','') ~ '^[0-9]+$'
      then (o.metadata->>'size')::bigint
      else 0
    end
  ),0)::bigint
  into v_existing_size
  from storage.objects o
  where o.bucket_id = any(array['produtos','totem-images','products','categories','covers'])
    and (storage.foldername(o.name))[1] = v_folder
    and not (o.bucket_id=_bucket_id and o.name=_name);

  return v_existing_size + v_new_size <= v_limit;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return false;
end
$$;

revoke all on function public.visionfood_storage_quota_allowed(text,text,jsonb)
from public,anon;
grant execute on function public.visionfood_storage_quota_allowed(text,text,jsonb)
to authenticated,service_role;

drop policy if exists "VisionFood authenticated tenant image insert" on storage.objects;
create policy "VisionFood authenticated tenant image insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = any(array['produtos','totem-images','products','categories','covers'])
  and public.visionfood_storage_org_path_allowed(name)
  and public.visionfood_storage_quota_allowed(bucket_id,name,metadata)
);

drop policy if exists "VisionFood authenticated tenant image update" on storage.objects;
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
  and public.visionfood_storage_quota_allowed(bucket_id,name,metadata)
);
