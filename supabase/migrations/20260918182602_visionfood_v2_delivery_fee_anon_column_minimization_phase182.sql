revoke select on table public.taxas_entrega from anon;

grant select (
  id,
  organization_id,
  nome_bairro,
  valor_taxa,
  tempo_estimado,
  ativo
) on table public.taxas_entrega to anon;
