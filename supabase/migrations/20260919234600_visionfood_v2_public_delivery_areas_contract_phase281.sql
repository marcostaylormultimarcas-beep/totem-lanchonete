-- VisionFood V2 PHASE 281
-- Keep the public delivery-area RPC intentionally callable by anon/authenticated,
-- while aligning its public contract with the authoritative bairro checkout path.
--
-- Confirmed contract gaps:
-- 1) _org could be null while taxas_entrega.organization_id is nullable; fail closed
--    instead of relying on the default-organization behavior of
--    visionfood_public_organization(null, null).
-- 2) The public RPC treated ativo = null as active, while the authoritative
--    checkout accepts only ativo = true.
-- 3) The public RPC returned the raw configured fee, while the authoritative
--    checkout clamps bairro delivery fees to a minimum of zero.
--
-- Current remote data is clean for all three cases, so this is a preventive
-- contract-alignment fix with no expected change for valid current rows.

create or replace function public.visionfood_public_delivery_areas(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when _org is null then '[]'::jsonb
    when coalesce(
      (public.visionfood_public_organization(_org, null)->>'paused')::boolean,
      true
    ) then '[]'::jsonb
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'nome_bairro', coalesce(t.nome_bairro, ''),
          'valor_taxa', greatest(coalesce(t.valor_taxa, t.taxa_entrega, 0), 0),
          'tempo_estimado', coalesce(t.tempo_estimado, 30),
          'ativo', true
        )
        order by t.nome_bairro, t.id
      )
      from public.taxas_entrega t
      where t.organization_id = _org
        and t.ativo is true
    ), '[]'::jsonb)
  end
$function$;
