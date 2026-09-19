-- VisionFood V2 PHASE 282
-- Keep the loyalty public contract intentionally callable/readable by anon,
-- while aligning campaign validity with the authoritative loyalty award path.
--
-- Confirmed contract gaps:
-- 1) LoyaltyPanel used legacy/nonexistent valido_de/valido_ate client fields instead
--    of the live data_inicio/data_fim columns (fixed in the frontend commit).
-- 2) The public RPC and anon row policy compared data_fim with now(), while the
--    authoritative award path evaluates validity by current_date. With the
--    date-only admin UI, that could hide a campaign during its configured final day.
--
-- No remote migration is applied by this file creation.

create or replace function public.visionfood_public_loyalty_config(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when coalesce(
      (public.visionfood_public_organization(_org, null)->>'paused')::boolean,
      true
    ) then '{}'::jsonb
    else coalesce((
      select jsonb_build_object(
        'ativo', coalesce(c.ativo, false),
        'meta_pedidos', greatest(coalesce(c.meta_pedidos, 10), 1),
        'valor_minimo_pedido', greatest(coalesce(c.valor_minimo_pedido, 0), 0),
        'premio_recompensa', coalesce(c.premio_recompensa, ''),
        'descricao_premio', coalesce(c.descricao_premio, ''),
        'premio_imagem', coalesce(c.premio_imagem, '')
      )
      from public.config_fidelidade c
      where c.organization_id = _org
        and coalesce(c.ativo, false) = true
        and (c.data_inicio is null or current_date >= c.data_inicio)
        and (c.data_fim is null or current_date <= c.data_fim)
      order by c.updated_at desc nulls last, c.created_at desc nulls last, c.id desc
      limit 1
    ), '{}'::jsonb)
  end
$function$;

drop policy if exists "visionfood anon read active config_fidelidade"
  on public.config_fidelidade;

create policy "visionfood anon read active config_fidelidade"
on public.config_fidelidade
for select
to anon
using (
  public.visionfood_public_organization(organization_id, null)
    @> '{"paused":false,"status":"ativo"}'::jsonb
  and coalesce(ativo, false) = true
  and (data_inicio is null or current_date >= data_inicio)
  and (data_fim is null or current_date <= data_fim)
);
