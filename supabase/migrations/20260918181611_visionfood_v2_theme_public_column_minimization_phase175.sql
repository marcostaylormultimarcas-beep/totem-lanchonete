revoke select on table public.loja_temas from anon,authenticated;

grant select (
  organization_id,
  primary_color,
  secondary_color,
  mode
) on table public.loja_temas to anon,authenticated;
