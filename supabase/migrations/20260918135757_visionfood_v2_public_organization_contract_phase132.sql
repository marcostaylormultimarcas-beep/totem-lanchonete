create or replace function public.visionfood_public_organization(
  _org_id uuid default null,
  _slug text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  if _org_id is not null and nullif(btrim(coalesce(_slug,'')),'') is not null then
    raise exception 'provide organization id or slug, not both';
  end if;

  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'slug', o.slug,
    'logo_url', coalesce(o.logo_url,''),
    'endereco', coalesce(o.endereco,''),
    'cidade', coalesce(o.cidade,''),
    'estado', coalesce(o.estado,''),
    'cep', coalesce(o.cep,''),
    'telefone', coalesce(o.telefone,''),
    'whatsapp', coalesce(o.whatsapp,''),
    'instagram', coalesce(o.instagram,''),
    'latitude', o.latitude,
    'longitude', o.longitude,
    'categoria', coalesce(o.categoria,'outro'),
    'ativo', coalesce(o.ativo,true),
    'bloqueado', coalesce(o.bloqueado,false),
    'status', coalesce(o.status,'ativo'),
    'paused', (not coalesce(o.ativo,true) or coalesce(o.bloqueado,false))
  )
  into v_result
  from public.organizations o
  where
    (_org_id is not null and o.id=_org_id)
    or (
      _org_id is null
      and nullif(btrim(coalesce(_slug,'')),'') is not null
      and lower(btrim(o.slug))=lower(btrim(_slug))
    )
    or (
      _org_id is null
      and nullif(btrim(coalesce(_slug,'')),'') is null
    )
  order by o.created_at asc
  limit 1;

  return v_result;
end
$$;

revoke all on function public.visionfood_public_organization(uuid,text) from public;
grant execute on function public.visionfood_public_organization(uuid,text)
to anon,authenticated,service_role;
