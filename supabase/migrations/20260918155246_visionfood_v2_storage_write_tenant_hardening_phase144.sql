create or replace function public.visionfood_storage_org_path_allowed(_name text)
returns boolean
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_folder text;
begin
  v_folder := (storage.foldername(_name))[1];

  if v_folder is null
     or v_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  return public.usuario_dono_org(v_folder::uuid,(select auth.uid()));
exception
  when invalid_text_representation then
    return false;
end
$$;

revoke all on function public.visionfood_storage_org_path_allowed(text) from public,anon;
grant execute on function public.visionfood_storage_org_path_allowed(text)
to authenticated,service_role;

drop policy if exists "Anyone can delete product images" on storage.objects;
drop policy if exists "Anyone can update product images" on storage.objects;
drop policy if exists "Anyone can upload product images" on storage.objects;
drop policy if exists "Permitir atualizar e deletar imagens" on storage.objects;
drop policy if exists "Permitir upload de imagens" on storage.objects;

create policy "VisionFood authenticated tenant image insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = any(array['produtos','totem-images','products','categories','covers'])
  and public.visionfood_storage_org_path_allowed(name)
);

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
);

create policy "VisionFood authenticated tenant image delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = any(array['produtos','totem-images','products','categories','covers'])
  and public.visionfood_storage_org_path_allowed(name)
);
