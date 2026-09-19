create or replace function public.visionfood_public_called_tickets(
  _org uuid,
  _limit integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_limit integer;
  v_result jsonb;
begin
  if _org is null then
    raise exception 'invalid_organization';
  end if;

  v_limit := greatest(1,least(coalesce(_limit,5),20));

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',q.id,
        'numero',coalesce(q.numero,q.numero_senha,q.senha,''),
        'tipo',coalesce(q.tipo,'normal'),
        'called_at',coalesce(q.called_at,q.created_at)
      )
      order by coalesce(q.called_at,q.created_at) desc,q.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select *
    from public.senhas_chamadas s
    where s.organization_id=_org
    order by coalesce(s.called_at,s.created_at) desc,s.id desc
    limit v_limit
  ) q;

  return v_result;
end
$$;

revoke all on function public.visionfood_public_called_tickets(uuid,integer) from public;
grant execute on function public.visionfood_public_called_tickets(uuid,integer)
to anon,authenticated,service_role;
