create or replace function public.visionfood_public_theme(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when _org is null
      or coalesce(
        (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
        true
      )
    then '{}'::jsonb
    else coalesce((
      select jsonb_build_object(
        'primary_color',
          case
            when primary_match.m is not null
              and (primary_match.m)[1]::int between 0 and 360
              and (primary_match.m)[2]::int between 0 and 100
              and (primary_match.m)[3]::int between 0 and 100
            then format(
              '%s %s%% %s%%',
              (primary_match.m)[1]::int,
              (primary_match.m)[2]::int,
              (primary_match.m)[3]::int
            )
            else '25 95% 53%'
          end,
        'secondary_color',
          case
            when secondary_match.m is not null
              and (secondary_match.m)[1]::int between 0 and 360
              and (secondary_match.m)[2]::int between 0 and 100
              and (secondary_match.m)[3]::int between 0 and 100
            then format(
              '%s %s%% %s%%',
              (secondary_match.m)[1]::int,
              (secondary_match.m)[2]::int,
              (secondary_match.m)[3]::int
            )
            else '0 72% 51%'
          end,
        'mode',
          case
            when lower(
              btrim(
                coalesce(
                  nullif(btrim(t.mode),''),
                  nullif(btrim(t.modo_app),''),
                  'dark'
                )
              )
            )='light'
            then 'light'
            else 'dark'
          end
      )
      from public.loja_temas t
      left join lateral (
        select regexp_match(
          coalesce(
            nullif(btrim(t.primary_color),''),
            nullif(btrim(t.cor_primaria),''),
            ''
          ),
          '^([0-9]{1,3})[[:space:]]+([0-9]{1,3})%[[:space:]]+([0-9]{1,3})%$'
        ) as m
      ) primary_match on true
      left join lateral (
        select regexp_match(
          coalesce(
            nullif(btrim(t.secondary_color),''),
            nullif(btrim(t.cor_secundaria),''),
            ''
          ),
          '^([0-9]{1,3})[[:space:]]+([0-9]{1,3})%[[:space:]]+([0-9]{1,3})%$'
        ) as m
      ) secondary_match on true
      where t.organization_id=_org
      order by t.created_at desc nulls last,t.id desc
      limit 1
    ),'{}'::jsonb)
  end
$function$;

revoke all on function public.visionfood_public_theme(uuid) from public;
grant execute on function public.visionfood_public_theme(uuid) to anon,authenticated;
