create or replace function public.visionfood_public_delivery_areas(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when not exists (
      select 1
      from public.organizations o
      where o.id = _org
        and coalesce(o.ativo, true) = true
        and coalesce(o.bloqueado, false) = false
    ) then '[]'::jsonb
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'nome_bairro', coalesce(t.nome_bairro, ''),
          'valor_taxa', coalesce(t.valor_taxa, t.taxa_entrega, 0),
          'tempo_estimado', coalesce(t.tempo_estimado, 30),
          'ativo', coalesce(t.ativo, true)
        )
        order by t.nome_bairro, t.id
      )
      from public.taxas_entrega t
      where t.organization_id = _org
        and coalesce(t.ativo, true) = true
    ), '[]'::jsonb)
  end
$function$;

revoke all on function public.visionfood_public_delivery_areas(uuid) from public;
grant execute on function public.visionfood_public_delivery_areas(uuid) to anon, authenticated;

create or replace function public.visionfood_public_theme(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when not exists (
      select 1
      from public.organizations o
      where o.id = _org
        and coalesce(o.ativo, true) = true
        and coalesce(o.bloqueado, false) = false
    ) then '{}'::jsonb
    else coalesce((
      select jsonb_build_object(
        'primary_color', coalesce(nullif(t.primary_color, ''), nullif(t.cor_primaria, ''), '25 95% 53%'),
        'secondary_color', coalesce(nullif(t.secondary_color, ''), nullif(t.cor_secundaria, ''), '0 72% 51%'),
        'mode', case
          when lower(coalesce(nullif(t.mode, ''), nullif(t.modo_app, ''), 'dark')) = 'light' then 'light'
          else 'dark'
        end
      )
      from public.loja_temas t
      where t.organization_id = _org
      order by t.created_at desc nulls last, t.id desc
      limit 1
    ), '{}'::jsonb)
  end
$function$;

revoke all on function public.visionfood_public_theme(uuid) from public;
grant execute on function public.visionfood_public_theme(uuid) to anon, authenticated;

create or replace function public.visionfood_public_loyalty_config(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when not exists (
      select 1
      from public.organizations o
      where o.id = _org
        and coalesce(o.ativo, true) = true
        and coalesce(o.bloqueado, false) = false
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
        and (c.data_inicio is null or c.data_inicio <= now())
        and (c.data_fim is null or c.data_fim >= now())
      order by c.updated_at desc nulls last, c.created_at desc nulls last, c.id desc
      limit 1
    ), '{}'::jsonb)
  end
$function$;

revoke all on function public.visionfood_public_loyalty_config(uuid) from public;
grant execute on function public.visionfood_public_loyalty_config(uuid) to anon, authenticated;
