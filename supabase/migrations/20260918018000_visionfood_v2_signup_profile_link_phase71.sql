-- Phase 71: make signup profile creation match the current client contract.
alter table public.profiles add column if not exists email text;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
  begin org:=nullif(new.raw_user_meta_data->>'organization_id','')::uuid;
  exception when invalid_text_representation then org:=null; end;
  if org is not null and not exists(select 1 from public.organizations where id=org and coalesce(ativo,true)=true) then org:=null; end if;
  insert into public.profiles(user_id,display_name,email,phone,organization_id,origem_assinatura_empresa_id)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name',''),new.email,nullif(new.raw_user_meta_data->>'phone',''),org,org)
  on conflict(user_id) do update set
    display_name=excluded.display_name,email=excluded.email,
    phone=coalesce(excluded.phone,public.profiles.phone),
    organization_id=coalesce(public.profiles.organization_id,excluded.organization_id),
    origem_assinatura_empresa_id=coalesce(public.profiles.origem_assinatura_empresa_id,excluded.origem_assinatura_empresa_id),
    updated_at=now();
  return new;
end$$;
