
update public.entregadores
   set password=case
       when coalesce(password,'') like '$2%' then password
       else extensions.crypt(
         coalesce(nullif(password,''),nullif(senha,'')),
         extensions.gen_salt('bf',10)
       )
     end,
       senha=null,
       updated_at=now()
 where nullif(coalesce(password,senha),'') is not null
   and (
     coalesce(password,'') not like '$2%'
     or nullif(senha,'') is not null
   );

create or replace function public.visionfood_hash_entregador_password()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  raw_password text;
begin
  if tg_op='INSERT' then
    raw_password:=coalesce(nullif(new.password,''),nullif(new.senha,''));
    if raw_password is not null then
      new.password:=case
        when raw_password like '$2%' then raw_password
        else extensions.crypt(raw_password,extensions.gen_salt('bf',10))
      end;
      new.senha:=null;
    end if;
    return new;
  end if;

  if new.password is distinct from old.password
     and nullif(new.password,'') is not null then
    raw_password:=new.password;
  elsif new.senha is distinct from old.senha
     and nullif(new.senha,'') is not null then
    raw_password:=new.senha;
  else
    return new;
  end if;

  new.password:=case
    when raw_password like '$2%' then raw_password
    else extensions.crypt(raw_password,extensions.gen_salt('bf',10))
  end;
  new.senha:=null;
  return new;
end
$$;

revoke execute on function public.visionfood_hash_entregador_password()
  from public,anon,authenticated;
grant execute on function public.visionfood_hash_entregador_password()
  to service_role;

drop trigger if exists trg_visionfood_hash_entregador_password
  on public.entregadores;

create trigger trg_visionfood_hash_entregador_password
before insert or update of password,senha
on public.entregadores
for each row
execute function public.visionfood_hash_entregador_password();

revoke select on table public.entregadores
  from anon,authenticated;

grant select(
  id,organization_id,nome,usuario,ativo,telefone,
  ultima_lat,ultima_lng,ultima_localizacao_at,ultima_localizacao_pedido_id,
  created_at,updated_at,active,name,username
) on public.entregadores
to authenticated;
