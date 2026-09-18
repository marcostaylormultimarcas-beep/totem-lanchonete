
create index if not exists idx_parceria_cupons_parceria_id
  on public.parceria_cupons(parceria_id);

create index if not exists idx_parceria_cupons_org_origem
  on public.parceria_cupons(org_origem);

create index if not exists idx_parceria_cupons_org_parceira
  on public.parceria_cupons(org_parceira);

create index if not exists idx_parcerias_org_parceira
  on public.parcerias(org_parceira);

create index if not exists idx_product_reviews_order_id
  on public.product_reviews(order_id);

create index if not exists idx_product_reviews_organization_id
  on public.product_reviews(organization_id);

create index if not exists idx_product_reviews_user_id
  on public.product_reviews(user_id);
