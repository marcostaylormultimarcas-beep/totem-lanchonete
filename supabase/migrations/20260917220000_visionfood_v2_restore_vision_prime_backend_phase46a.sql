-- Phase 46A: restore Vision Prime membership backend with least-privilege access.
create table if not exists public.vision_prime_assinaturas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','inactive','cancelled')),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,user_id)
);
create index if not exists vision_prime_assinaturas_user_org_idx
  on public.vision_prime_assinaturas(user_id,organization_id);
alter table public.vision_prime_assinaturas enable row level security;
revoke all on table public.vision_prime_assinaturas from anon, authenticated;
grant select on table public.vision_prime_assinaturas to authenticated;
drop policy if exists "prime own select" on public.vision_prime_assinaturas;
create policy "prime own select" on public.vision_prime_assinaturas
  for select to authenticated using ((select auth.uid())=user_id);

create or replace function public.vision_prime_my_status(_org uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_uid uuid := auth.uid(); v_row public.vision_prime_assinaturas%rowtype;
begin
 if v_uid is null then return jsonb_build_object('active',false); end if;
 select * into v_row from public.vision_prime_assinaturas where organization_id=_org and user_id=v_uid;
 if not found then return jsonb_build_object('active',false); end if;
 if v_row.status='active' and (v_row.expires_at is null or v_row.expires_at>now()) then
   return jsonb_build_object('active',true,'since_year',extract(year from v_row.started_at)::int,'expires_at',v_row.expires_at);
 end if;
 return jsonb_build_object('active',false);
end $$;
revoke all on function public.vision_prime_my_status(uuid) from public, anon;
grant execute on function public.vision_prime_my_status(uuid) to authenticated;

create or replace function public.vision_prime_subscribe(_org uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_enabled boolean;
begin
 if v_uid is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 select coalesce(ativo,false) into v_enabled from public.vision_prime_config where organization_id=_org;
 if coalesce(v_enabled,false) is not true then return jsonb_build_object('ok',false,'reason','inactive'); end if;
 insert into public.vision_prime_assinaturas(organization_id,user_id,status,started_at,expires_at)
 values(_org,v_uid,'active',now(),now()+interval '30 days')
 on conflict(organization_id,user_id) do update
 set status='active',started_at=now(),expires_at=now()+interval '30 days',updated_at=now();
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.vision_prime_subscribe(uuid) from public, anon;
grant execute on function public.vision_prime_subscribe(uuid) to authenticated;
