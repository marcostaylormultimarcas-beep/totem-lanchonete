-- PHASE 284
-- Keep anon exposure intentional, but make the persisted slug uniqueness contract
-- match the RPC lookup semantics (trimmed + case-insensitive).
--
-- The RPC intentionally keeps the existing NULL/NULL fallback used by the legacy
-- unscoped "/" kiosk route. Exact id/slug selectors remain tenant-scoped.

create unique index if not exists organizations_slug_normalized_unique
on public.organizations ((lower(btrim(slug))));

create or replace function public.visionfood_public_organization(
  _org_id uuid default null::uuid,
  _slug text default null::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_slug text := nullif(lower(btrim(coalesce(_slug,''))), '');
  v_result jsonb;
begin
  if _org_id is not null and v_slug is not null then
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
    'paused', (
      not coalesce(o.ativo,true)
      or coalesce(o.bloqueado,false)
      or coalesce(o.status,'ativo')<>'ativo'
      or coalesce(o.status_assinatura,'ativo')<>'ativo'
    )
  )
  into v_result
  from public.organizations o
  where
    (_org_id is not null and o.id=_org_id)
    or (
      _org_id is null
      and v_slug is not null
      and lower(btrim(o.slug))=v_slug
    )
    or (
      _org_id is null
      and v_slug is null
      and coalesce(o.ativo,true)=true
      and coalesce(o.bloqueado,false)=false
      and coalesce(o.status,'ativo')='ativo'
      and coalesce(o.status_assinatura,'ativo')='ativo'
    )
  order by o.created_at asc
  limit 1;

  return v_result;
end
$function$;

revoke all on function public.visionfood_public_organization(uuid,text) from public;
grant execute on function public.visionfood_public_organization(uuid,text)
to anon,authenticated,service_role;
