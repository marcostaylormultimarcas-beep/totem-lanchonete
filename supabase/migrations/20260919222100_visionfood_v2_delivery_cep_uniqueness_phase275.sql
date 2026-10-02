-- VisionFood V2 PHASE 275
-- validar_cep_entrega resolves lista_ceps by organization + normalized CEP and
-- returns a single row. Keep that lookup deterministic even if the same CEP is
-- entered more than once with different formatting.
--
-- Remote audit before this migration:
-- - current data has no duplicate normalized CEP keys;
-- - the admin writes normalized 8-digit CEPs but performs a direct INSERT;
-- - the live schema has no unique constraint/index covering organization + CEP.

create unique index if not exists ux_cep_atendidos_org_normalized_cep
on public.cep_atendidos (
  organization_id,
  (regexp_replace(cep, '[^0-9]', '', 'g'))
)
where cep is not null;
