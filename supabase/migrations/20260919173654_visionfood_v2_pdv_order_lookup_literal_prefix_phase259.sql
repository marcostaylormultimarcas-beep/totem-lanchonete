-- PHASE 259
-- Harden PDV order lookup so UUID-prefix matching is literal.
-- Keeps anon/custom-session access intentional; tenant isolation and return contract unchanged.

create or replace function public.pdv_buscar_pedido_v2(_session_token text, _query text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  s public.pdv_sessions%rowtype;
  o public.orders%rowtype;
  h text;
  q text := btrim(coalesce(_query,''));
begin
  h := encode(extensions.digest(coalesce(_session_token,''),'sha256'),'hex');

  select *
    into s
  from public.pdv_sessions
  where token_hash = h
    and revoked_at is null
    and expires_at > now();

  if s.id is null then
    return jsonb_build_object('ok',false,'reason','invalid_session');
  end if;

  if length(q) < 4 then
    return jsonb_build_object('ok',false,'reason','invalid_query');
  end if;

  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select *
      into o
    from public.orders
    where id = q::uuid
      and organization_id = s.organization_id
    limit 1;
  else
    select *
      into o
    from public.orders
    where organization_id = s.organization_id
      and (
        lower(order_number) = lower(q)
        or left(id::text, length(q)) = lower(q)
      )
    order by created_at desc
    limit 1;
  end if;

  if o.id is null then
    return jsonb_build_object('ok',false,'reason','order_not_found');
  end if;

  update public.pdv_sessions
     set last_seen_at = now()
   where id = s.id;

  return jsonb_build_object(
    'ok',true,
    'order',jsonb_build_object(
      'id',o.id,
      'order_number',o.order_number,
      'items',o.items,
      'total',o.total,
      'status',o.status,
      'customer_name',o.customer_name,
      'created_at',o.created_at
    )
  );
end
$function$;
