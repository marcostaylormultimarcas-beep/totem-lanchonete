alter table public.settings
  add column if not exists taxa_vision_percent numeric not null default 0;

drop view if exists public.v_financeiro_detalhado;

create view public.v_financeiro_detalhado
with (security_invoker = true)
as
select
  o.id as order_id,
  o.organization_id,
  o.order_number,
  o.created_at,
  o.status,
  coalesce(
    nullif(btrim(o.payment_method),''),
    nullif(btrim(o.forma_pagamento),''),
    nullif(btrim(o.metodo_pagamento),'')
  ) as payment_method,
  o.customer_name,
  o.total as valor_bruto,
  0::numeric as taxa_gateway_valor,
  round(
    o.total * coalesce(s.taxa_vision_percent,0) / 100.0,
    2
  ) as taxa_vision_valor,
  round(
    o.total - (o.total * coalesce(s.taxa_vision_percent,0) / 100.0),
    2
  ) as valor_liquido_final
from public.orders o
left join public.settings s
  on s.organization_id=o.organization_id
where o.status <> 'cancelled';

revoke all on table public.v_financeiro_detalhado from anon;
grant select on table public.v_financeiro_detalhado to authenticated,service_role;
