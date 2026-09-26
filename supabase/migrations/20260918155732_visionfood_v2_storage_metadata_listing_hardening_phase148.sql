drop policy if exists "Permitir leitura publica de imagens" on storage.objects;
drop policy if exists "Product images are public" on storage.objects;

drop policy if exists "VisionFood authenticated tenant image select" on storage.objects;
create policy "VisionFood authenticated tenant image select"
on storage.objects
for select
to authenticated
using (
  bucket_id = any(array['produtos','totem-images','products','categories','covers'])
  and public.visionfood_storage_org_path_allowed(name)
);
