drop policy if exists "visionfood public read products"
on public.products;

revoke select on table public.products from anon;
