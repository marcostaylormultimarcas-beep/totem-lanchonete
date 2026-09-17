-- VisionFood V2 phase 40: additive checkout contract + atomic per-org order number.
-- Prepared for validation first. Do not apply to production without explicit authorization.

alter table public.orders add column if not exists scheduled_for timestamptz;
alter table public.orders add column if not exists nfe_url text;
alter table public.orders add column if not exists nfe_status text;
alter table public.orders add column if not exists nfe_numero text;

create table if not exists public.order_number_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.order_number_counters enable row level security;
revoke all on table public.order_number_counters from anon, authenticated;

create or replace function public.next_order_number(_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _n bigint;
begin
  if _organization_id is null then
    raise exception 'organization_id is required';
  end if;

  insert into public.order_number_counters(organization_id, last_number)
  values (
    _organization_id,
    coalesce((select max(case when order_number ~ '^[0-9]+$' then order_number::bigint end)
              from public.orders where organization_id = _organization_id), 0) + 1
  )
  on conflict (organization_id) do update
    set last_number = public.order_number_counters.last_number + 1,
        updated_at = now()
  returning last_number into _n;

  return lpad(_n::text, 3, '0');
end;
$$;

revoke all on function public.next_order_number(uuid) from public;
grant execute on function public.next_order_number(uuid) to anon, authenticated;

create unique index if not exists orders_org_order_number_uidx
  on public.orders(organization_id, order_number)
  where organization_id is not null;
