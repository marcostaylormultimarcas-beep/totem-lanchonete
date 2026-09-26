create or replace function public.visionfood_public_organization(
  _org_id uuid default null::uuid,
  _slug text default null::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if _org_id is not null and nullif(btrim(coalesce(_slug,'')),'') is not null then
    raise exception 'provide organization id or slug, not both';
  end if;

  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'slug', o.slug,
    'logo_url', coalesce(o.logo_url,''),
    'endereco', coalesce(o.endereco,''),
    'cidade', coalesce(o.cidade,''),
    'estado', coalesce(o.estado,''),
    'cep', coalesce(o.cep,''),
    'telefone', coalesce(o.telefone,''),
    'whatsapp', coalesce(o.whatsapp,''),
    'instagram', coalesce(o.instagram,''),
    'latitude', o.latitude,
    'longitude', o.longitude,
    'categoria', coalesce(o.categoria,'outro'),
    'ativo', coalesce(o.ativo,true),
    'bloqueado', coalesce(o.bloqueado,false),
    'status', coalesce(o.status,'ativo'),
    'paused', (
      not coalesce(o.ativo,true)
      or coalesce(o.bloqueado,false)
      or coalesce(o.status,'ativo')<>'ativo'
      or coalesce(o.status_assinatura,'ativo')<>'ativo'
    )
  )
  into v_result
  from public.organizations o
  where
    (_org_id is not null and o.id=_org_id)
    or (
      _org_id is null
      and nullif(btrim(coalesce(_slug,'')),'') is not null
      and lower(btrim(o.slug))=lower(btrim(_slug))
    )
    or (
      _org_id is null
      and nullif(btrim(coalesce(_slug,'')),'') is null
      and coalesce(o.ativo,true)=true
      and coalesce(o.bloqueado,false)=false
      and coalesce(o.status,'ativo')='ativo'
      and coalesce(o.status_assinatura,'ativo')='ativo'
    )
  order by o.created_at asc
  limit 1;

  return v_result;
end
$function$;

create or replace function public.visionfood_public_catalog(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when coalesce(
      (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
      true
    ) then '[]'::jsonb
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',p.id,
          'name',p.name,
          'price',p.price,
          'category',p.category,
          'image',p.image,
          'removable_ingredients',coalesce(p.removable_ingredients,'[]'::jsonb),
          'extras',coalesce(p.extras,'[]'::jsonb),
          'is_combo',coalesce(p.is_combo,false),
          'ingredients',coalesce(p.ingredients,'[]'::jsonb),
          'description',coalesce(p.description,''),
          'organization_id',p.organization_id,
          'available',true,
          'codigo_barras',coalesce(p.codigo_barras,''),
          'sold_by_weight',coalesce(p.sold_by_weight,false),
          'prep_time_min',0
        )
        order by p.name,p.id
      )
      from public.products p
      where p.organization_id=_org
        and coalesce(p.available,true)=true
        and coalesce(p.ingredient_stock_blocked,false)=false
        and (coalesce(p.manage_stock,false)=false or coalesce(p.stock_quantity,0)>0)
    ),'[]'::jsonb)
  end
$function$;

create or replace function public.visionfood_public_storefront_config(_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if _org is null then
    raise exception 'invalid_organization';
  end if;

  if coalesce(
    (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
    true
  ) then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'organization_id',o.id,
    'store_name',coalesce(nullif(s.store_name,''),nullif(s.nome_loja,''),nullif(o.name,''),'VisionFood'),
    'whatsapp_number',coalesce(nullif(s.whatsapp_number,''),nullif(s.telefone,''),nullif(s.phone,''),nullif(o.whatsapp,''),nullif(o.telefone,''),''),
    'share_image',coalesce(nullif(s.cover_image,''),nullif(s.imagem_capa,''),nullif(s.logo_url,''),nullif(o.logo_url,''),''),
    'combo',coalesce(s.combo,'{}'::jsonb),
    'banners',coalesce(s.banners,'[]'::jsonb),
    'instagram_url',coalesce(nullif(s.instagram_url,''),nullif(o.instagram,''),''),
    'categories',coalesce(s.categories,'[]'::jsonb),
    'category_icons',coalesce(s.category_icons,'{}'::jsonb),
    'delivery_enabled',coalesce(s.delivery_enabled,true),
    'business_hours',s.business_hours,
    'emergency_closed',coalesce(s.emergency_closed,false),
    'closed_message',coalesce(nullif(s.closed_message,''),'Lanchonete fechada no momento'),
    'scheduling_enabled',coalesce(s.scheduling_enabled,true),
    'balanca_baud_rate',coalesce(s.balanca_baud_rate,9600),
    'delivery_tempo_base_min',coalesce(s.delivery_tempo_base_min,s.delivery_tempo_estimado,30),
    'delivery_mode',coalesce(s.delivery_mode,'bairros'),
    'updated_at',s.updated_at
  )
  into v_result
  from public.organizations o
  left join public.settings s on s.organization_id=o.id
  where o.id=_org
  limit 1;

  return coalesce(v_result,'{}'::jsonb);
end
$function$;

create or replace function public.visionfood_public_called_tickets(_org uuid,_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer;
  v_result jsonb;
begin
  if _org is null then
    raise exception 'invalid_organization';
  end if;

  if coalesce(
    (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
    true
  ) then
    return '[]'::jsonb;
  end if;

  v_limit:=greatest(1,least(coalesce(_limit,5),20));

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
$function$;

create or replace function public.visionfood_public_delivery_areas(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when coalesce(
      (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
      true
    ) then '[]'::jsonb
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',t.id,
          'nome_bairro',coalesce(t.nome_bairro,''),
          'valor_taxa',coalesce(t.valor_taxa,t.taxa_entrega,0),
          'tempo_estimado',coalesce(t.tempo_estimado,30),
          'ativo',coalesce(t.ativo,true)
        )
        order by t.nome_bairro,t.id
      )
      from public.taxas_entrega t
      where t.organization_id=_org
        and coalesce(t.ativo,true)=true
    ),'[]'::jsonb)
  end
$function$;

create or replace function public.visionfood_public_loyalty_config(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when coalesce(
      (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
      true
    ) then '{}'::jsonb
    else coalesce((
      select jsonb_build_object(
        'ativo',coalesce(c.ativo,false),
        'meta_pedidos',greatest(coalesce(c.meta_pedidos,10),1),
        'valor_minimo_pedido',greatest(coalesce(c.valor_minimo_pedido,0),0),
        'premio_recompensa',coalesce(c.premio_recompensa,''),
        'descricao_premio',coalesce(c.descricao_premio,''),
        'premio_imagem',coalesce(c.premio_imagem,'')
      )
      from public.config_fidelidade c
      where c.organization_id=_org
        and coalesce(c.ativo,false)=true
        and (c.data_inicio is null or c.data_inicio<=now())
        and (c.data_fim is null or c.data_fim>=now())
      order by c.updated_at desc nulls last,c.created_at desc nulls last,c.id desc
      limit 1
    ),'{}'::jsonb)
  end
$function$;

create or replace function public.visionfood_public_theme(_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when coalesce(
      (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
      true
    ) then '{}'::jsonb
    else coalesce((
      select jsonb_build_object(
        'primary_color',coalesce(nullif(t.primary_color,''),nullif(t.cor_primaria,''),'25 95% 53%'),
        'secondary_color',coalesce(nullif(t.secondary_color,''),nullif(t.cor_secundaria,''),'0 72% 51%'),
        'mode',case
          when lower(coalesce(nullif(t.mode,''),nullif(t.modo_app,''),'dark'))='light' then 'light'
          else 'dark'
        end
      )
      from public.loja_temas t
      where t.organization_id=_org
      order by t.created_at desc nulls last,t.id desc
      limit 1
    ),'{}'::jsonb)
  end
$function$;

create or replace function public.validate_checkout_coupon(
  _organization_id uuid,
  _codigo text,
  _subtotal numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  if coalesce(
    (public.visionfood_public_organization(_organization_id,null)->>'paused')::boolean,
    true
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
$function$;

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
set search_path = ''
as $function$
  select
    coalesce(v.ativo,false),
    coalesce(v.valor_mensalidade,0),
    coalesce(v.desconto_percentual,0),
    coalesce(v.frete_gratis_minimo,0)
  from public.vision_prime_config v
  where v.organization_id=_org
    and coalesce(
      (public.visionfood_public_organization(_org,null)->>'paused')::boolean,
      true
    )=false
  limit 1
$function$;

create or replace function public.visionfood_checkout_payment_config(_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  o public.organizations%rowtype;
  s public.settings%rowtype;
begin
  if _org is null then
    return jsonb_build_object('ok',false,'reason','invalid_organization');
  end if;

  select * into o
  from public.organizations
  where id=_org
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'reason','organization_not_found');
  end if;

  if coalesce(o.ativo,true) is not true
     or coalesce(o.bloqueado,false) is true
     or coalesce(o.status,'ativo')<>'ativo'
     or coalesce(o.status_assinatura,'ativo')<>'ativo' then
    return jsonb_build_object('ok',false,'reason','organization_unavailable');
  end if;

  select * into s
  from public.settings
  where organization_id=_org
  limit 1;

  return jsonb_build_object(
    'ok',true,
    'store_name',coalesce(nullif(btrim(s.store_name),''),nullif(btrim(o.name),''),'VisionFood'),
    'whatsapp_number',coalesce(s.whatsapp_number,''),
    'pix_key_manual',coalesce(s.pix_key_manual,''),
    'pay_cash_enabled',coalesce(s.pay_cash_enabled,true),
    'pay_pix_enabled',coalesce(s.pay_pix_enabled,true),
    'pay_card_terminal_enabled',coalesce(s.pay_card_terminal_enabled,false),
    'pay_card_online_enabled',coalesce(s.pay_card_online_enabled,false),
    'mp_terminal_id',coalesce(s.mp_terminal_id,''),
    'automatic_pix_supported',false
  );
end
$function$;
