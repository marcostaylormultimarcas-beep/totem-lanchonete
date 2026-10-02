update storage.buckets
set
  file_size_limit = 26214400,
  allowed_mime_types = array['image/*']::text[]
where id in ('produtos','products','categories','covers','totem-images');
