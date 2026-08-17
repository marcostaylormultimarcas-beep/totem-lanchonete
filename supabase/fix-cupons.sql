-- Estrutura + permissões da tabela de cupons (rodar no SQL Editor do Supabase externo)

create table if not exists public.cupons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  codigo text not null,
  tipo text not null default 'porcentagem',
  valor numeric not null default 0,
  ativo boolean not null default true,
  data_inicio timestamptz,
  data_fim timestamptz,
  created_at timestamptz not null default now()
);

-- colunas que podem faltar em bases antigas
alter table public.cupons add column if not exists organization_id uuid;
alter table public.cupons add column if not exists codigo text;
alter table public.cupons add column if not exists tipo text default 'porcentagem';
alter table public.cupons add column if not exists valor numeric default 0;
alter table public.cupons add column if not exists ativo boolean default true;
alter table public.cupons add column if not exists data_inicio timestamptz;
alter table public.cupons add column if not exists data_fim timestamptz;
alter table public.cupons add column if not exists created_at timestamptz default now();

create unique index if not exists uniq_cupons_org_codigo
  on public.cupons (organization_id, upper(codigo));

grant select on public.cupons to anon;
grant select, insert, update, delete on public.cupons to authenticated;
grant all on public.cupons to service_role;

alter table public.cupons enable row level security;

drop policy if exists "cupons_select_public" on public.cupons;
create policy "cupons_select_public" on public.cupons
  for select using (true);

drop policy if exists "cupons_write_authenticated" on public.cupons;
create policy "cupons_write_authenticated" on public.cupons
  for all to authenticated using (true) with check (true);
