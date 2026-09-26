create table if not exists private.coupon_rate_limits (
  scope_key text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_coupon_rate_limits_updated_at
  on private.coupon_rate_limits(updated_at);

revoke all on table private.coupon_rate_limits
from public,anon,authenticated;
grant select,insert,update,delete
on table private.coupon_rate_limits
to service_role;

create or replace function public.visionfood_coupon_rate_limit_check(_org uuid)
returns void
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_headers jsonb;
  v_ip_text text;
  v_ip inet;
  v_scope text;
  v_row private.coupon_rate_limits%rowtype;
begin
  if _org is null then
    return;
  end if;

  begin
    v_headers := coalesce(
      nullif(current_setting('request.headers',true),'')::jsonb,
      '{}'::jsonb
    );
  exception
    when others then
      v_headers := '{}'::jsonb;
  end;

  v_ip_text := btrim(split_part(
    coalesce(
      nullif(v_headers->>'x-forwarded-for',''),
      nullif(v_headers->>'cf-connecting-ip',''),
      nullif(v_headers->>'x-real-ip',''),
      ''
    ),
    ',',
    1
  ));

  if v_ip_text='' then
    return;
  end if;

  begin
    v_ip := v_ip_text::inet;
  exception
    when invalid_text_representation then
      return;
  end;

  v_scope := 'coupon:' || encode(
    extensions.digest(_org::text || E'\n' || host(v_ip),'sha256'),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('visionfood:'||v_scope,0)
  );

  select *
  into v_row
  from private.coupon_rate_limits
  where scope_key=v_scope
  for update;

  if found and v_row.window_started_at <= now()-interval '5 minutes' then
    update private.coupon_rate_limits
       set window_started_at=now(),
           attempt_count=0,
           updated_at=now()
     where scope_key=v_scope
    returning * into v_row;
  end if;

  if found and v_row.attempt_count >= 60 then
    raise exception 'coupon_rate_limited';
  end if;

  insert into private.coupon_rate_limits(
    scope_key,window_started_at,attempt_count,updated_at
  )
  values(v_scope,now(),1,now())
  on conflict(scope_key) do update
    set attempt_count=private.coupon_rate_limits.attempt_count+1,
        updated_at=now();

  delete from private.coupon_rate_limits
  where updated_at < now()-interval '2 days';
end
$$;

revoke all on function public.visionfood_coupon_rate_limit_check(uuid)
from public,anon,authenticated;
grant execute on function public.visionfood_coupon_rate_limit_check(uuid)
to service_role;

create or replace function public.validate_checkout_coupon(
  _organization_id uuid,
  _codigo text,
  _subtotal numeric default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  c public.cupons%rowtype;
  code text:=upper(btrim(coalesce(_codigo,'')));
  st numeric:=greatest(0,coalesce(_subtotal,0));
  typ text;
  disc numeric;
begin
  if _organization_id is null or code='' then
    return jsonb_build_object('ok',false,'reason','invalid_code');
  end if;

  if not exists(
    select 1
    from public.organizations o
    where o.id=_organization_id
      and coalesce(o.ativo,true)=true
      and coalesce(o.bloqueado,false)=false
  ) then
    return jsonb_build_object('ok',false,'reason','invalid_organization');
  end if;

  perform public.visionfood_coupon_rate_limit_check(_organization_id);

  select *
  into c
  from public.cupons
  where organization_id=_organization_id
    and upper(codigo)=code
  limit 1;

  if c.id is null then
    return jsonb_build_object('ok',false,'reason','not_found');
  end if;
  if coalesce(c.ativo,true)=false or coalesce(c.status,true)=false then
    return jsonb_build_object('ok',false,'reason','inactive');
  end if;
  if c.data_inicio is not null and c.data_inicio>now() then
    return jsonb_build_object('ok',false,'reason','not_started');
  end if;
  if c.data_fim is not null and c.data_fim<now() then
    return jsonb_build_object('ok',false,'reason','expired');
  end if;
  if c.validade is not null and c.validade<now() then
    return jsonb_build_object('ok',false,'reason','expired');
  end if;
  if st<coalesce(c.minimo_pedido,0) then
    return jsonb_build_object(
      'ok',false,
      'reason','minimum_not_met',
      'minimo_pedido',coalesce(c.minimo_pedido,0)
    );
  end if;

  typ:=lower(coalesce(nullif(c.tipo,''),c.tipo_desconto,''));
  if typ in ('percentual','porcentagem','percent','percentage') then
    disc:=round(
      st*greatest(0,least(coalesce(c.valor,0),100))/100,
      2
    );
  else
    disc:=least(st,greatest(0,coalesce(c.valor,0)));
  end if;

  return jsonb_build_object(
    'ok',true,
    'cupom',jsonb_build_object(
      'id',c.id,
      'codigo',c.codigo,
      'tipo',typ,
      'valor',c.valor,
      'minimo_pedido',coalesce(c.minimo_pedido,0),
      'discount',disc
    )
  );
end
$$;

revoke all on function public.validate_checkout_coupon(uuid,text,numeric)
from public;
grant execute on function public.validate_checkout_coupon(uuid,text,numeric)
to anon,authenticated,service_role;
