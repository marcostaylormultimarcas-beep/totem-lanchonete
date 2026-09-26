-- VisionFood V2 PHASE 277
-- Keep vision_prime_public_config intentionally callable by anon/authenticated.
-- Direct access to vision_prime_config remains protected; this RPC exposes only
-- the four storefront fields required by useVisionPrimeConfig.
--
-- Confirmed contract divergence:
-- - the authoritative checkout clamps Prime discount to 0..100;
-- - the authoritative checkout clamps free-shipping minimum to >= 0;
-- - the admin save path clamps monthly fee/free-shipping minimum to >= 0 and
--   discount to 0..100;
-- - the public RPC previously returned raw database values. The table has no
--   CHECK constraints for these ranges, so a non-UI write could make the
--   storefront advertise values different from what checkout actually applies.
--
-- This change only normalizes the public projection. EXECUTE grants, owner,
-- SECURITY DEFINER status, search_path, organization availability filtering,
-- and the returned column set remain unchanged.

create or replace function public.vision_prime_public_config(_org uuid)
returns table(
  ativo boolean,
  valor_mensalidade numeric,
  desconto_percentual numeric,
  frete_gratis_minimo numeric
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    coalesce(v.ativo, false),
    greatest(coalesce(v.valor_mensalidade, 0), 0),
    least(greatest(coalesce(v.desconto_percentual, 0), 0), 100),
    greatest(coalesce(v.frete_gratis_minimo, 0), 0)
  from public.vision_prime_config v
  where v.organization_id = _org
    and coalesce(
      (public.visionfood_public_organization(_org, null)->>'paused')::boolean,
      true
    ) = false
  limit 1
$function$;
