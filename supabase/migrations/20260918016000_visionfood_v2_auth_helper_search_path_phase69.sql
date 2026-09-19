-- Phase 69: harden authorization helper SECURITY DEFINER functions.
create or replace function public.eh_super_admin(_uid uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.papeis_usuario where user_id=_uid and role='super_admin')$$;
create or replace function public.eh_master_admin(_uid uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.papeis_usuario where user_id=_uid and role='gerente')$$;
create or replace function public.usuario_dono_org(_org uuid,_uid uuid) returns boolean language sql stable security definer set search_path='' as $$select public.eh_super_admin(_uid) or exists(select 1 from public.organizations o where o.id=_org and (o.owner_id=_uid or (public.eh_master_admin(_uid) and o.master_id=_uid)))$$;
revoke all on function public.eh_super_admin(uuid),public.eh_master_admin(uuid),public.usuario_dono_org(uuid,uuid) from public,anon;
grant execute on function public.eh_super_admin(uuid),public.eh_master_admin(uuid),public.usuario_dono_org(uuid,uuid) to authenticated;
