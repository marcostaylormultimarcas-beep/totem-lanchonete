alter table public.products
  add column cost_price numeric null,
  add column markup_percent numeric null;

alter table public.products
  add constraint products_cost_price_nonnegative
    check (cost_price is null or cost_price >= 0),
  add constraint products_markup_percent_minimum
    check (markup_percent is null or markup_percent >= -100);

comment on column public.products.cost_price is
  'Direct product cost, per unit or per kg when sold_by_weight=true; CMV fallback when recipe cost is unavailable.';

comment on column public.products.markup_percent is
  'Pricing helper percentage over direct product cost.';
