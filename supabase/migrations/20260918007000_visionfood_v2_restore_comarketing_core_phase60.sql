-- Phase 60: restore Co-Marketing core compatible with current auth helpers.
alter table public.organizations add column if not exists categoria text not null default 'outro';
create table if not exists public.parcerias (
 id uuid primary key default gen_random_uuid(), org_origem uuid not null references public.organizations(id) on delete cascade,
 org_parceira uuid not null references public.organizations(id) on delete cascade, status text not null default 'pending' check(status in('pending','active','declined','suspended')),
 min_order_value numeric not null default 50 check(min_order_value>=0), discount_percent numeric not null default 10 check(discount_percent between 0 and 100),
 habilitada_origem boolean not null default true, habilitada_parceira boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint parcerias_distinct check(org_origem<>org_parceira), constraint parcerias_unique unique(org_origem,org_parceira));
alter table public.parcerias enable row level security;
create policy "parcerias members read" on public.parcerias for select to authenticated using(public.usuario_dono_org(org_origem,(select auth.uid())) or public.usuario_dono_org(org_parceira,(select auth.uid())) or public.eh_super_admin((select auth.uid())));
revoke all on public.parcerias from anon; grant select on public.parcerias to authenticated;
-- RPC definitions are installed by this migration in the official database:
-- parceria_request(uuid,uuid), parceria_respond(uuid,boolean), parceria_set_rules(uuid,numeric,numeric), parceria_toggle(uuid,boolean).
-- All are SECURITY DEFINER, search_path='', EXECUTE authenticated only, and authorize via usuario_dono_org/eh_super_admin.
