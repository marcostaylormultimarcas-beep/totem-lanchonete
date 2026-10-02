-- PHASE 304 follow-up: authoritative combo/upsell product contract.
-- A combo offered by the kiosk must resolve to a real public.products UUID so
-- authoritative quote/create paths never trust a synthetic client-side price.

create or replace function public.visionfood_upsert_combo_product(
  _org uuid,
  _name text,
  _price numeric,
  _description text default '',
  _image text default ''
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  normalized_name text:=btrim(coalesce(_name,''));
  normalized_description text:=btrim(coalesce(_description,''));
  normalized_image text:=btrim(coalesce(_image,''));
  combo_json jsonb;
  product_id uuid;
begin
  if auth.uid() is null or not private.usuario_dono_org(_org,auth.uid()) then
    raise exception 'forbidden';
  end if;

  if _org is null
     or char_length(normalized_name)<1
     or char_length(normalized_name)>50
     or _price is null
     or _price<=0
     or _price>1000000
     or char_length(normalized_description)>100
     or char_length(normalized_image)>2048 then
    raise exception 'invalid_combo';
  end if;

  select s.combo
    into combo_json
  from public.settings s
  where s.organization_id=_org
  limit 1
  for update;

  if combo_json is not null and nullif(combo_json->>'product_id','') is not null then
    begin
      product_id:=(combo_json->>'product_id')::uuid;
    exception when invalid_text_representation then
      product_id:=null;
    end;
  end if;

  if product_id is not null
     and not exists(
       select 1
       from public.products p
       where p.id=product_id
         and p.organization_id=_org
         and coalesce(p.is_combo,false)=true
     ) then
    product_id:=null;
  end if;

  if product_id is null then
    select p.id
      into product_id
    from public.products p
    where p.organization_id=_org
      and coalesce(p.is_combo,false)=true
      and p.category='visionfood_combo'
    order by p.created_at
    limit 1
    for update;
  end if;

  if product_id is null then
    insert into public.products(
      organization_id,name,price,category,image,description,
      removable_ingredients,extras,ingredients,is_combo,available,
      sold_by_weight,manage_stock,stock_quantity,ingredient_stock_blocked
    )
    values(
      _org,
      'Combo: '||normalized_name,
      round(_price,2),
      'visionfood_combo',
      coalesce(nullif(normalized_image,''),'🍟🥤'),
      normalized_description,
      '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,true,
      false,false,0,false
    )
    returning id into product_id;
  else
    update public.products
       set name='Combo: '||normalized_name,
           price=round(_price,2),
           category='visionfood_combo',
           image=coalesce(nullif(normalized_image,''),image,'🍟🥤'),
           description=normalized_description,
           removable_ingredients='[]'::jsonb,
           extras='[]'::jsonb,
           ingredients='[]'::jsonb,
           is_combo=true,
           available=true,
           sold_by_weight=false,
           manage_stock=false,
           ingredient_stock_blocked=false,
           updated_at=now()
     where id=product_id
       and organization_id=_org;
  end if;

  combo_json:=jsonb_build_object(
    'name',normalized_name,
    'description',normalized_description,
    'price',round(_price,2),
    'emoji',coalesce(nullif(combo_json->>'emoji',''),'🍟🥤'),
    'image',normalized_image,
    'product_id',product_id
  );

  insert into public.settings(organization_id,combo)
  values(_org,combo_json)
  on conflict(organization_id) do update
    set combo=excluded.combo,
        updated_at=now();

  return jsonb_build_object(
    'ok',true,
    'product_id',product_id,
    'combo',combo_json
  );
end
$function$;

revoke all on function public.visionfood_upsert_combo_product(uuid,text,numeric,text,text) from public, anon;
grant execute on function public.visionfood_upsert_combo_product(uuid,text,numeric,text,text) to authenticated, service_role;

-- Backfill the existing configured upsell for every organization that already
-- has a valid combo configuration. This mirrors the current behavior where the
-- upsell is offered globally after burger/pizza items.
do $do$
declare
  s record;
  combo_name text;
  combo_description text;
  combo_image text;
  combo_price numeric;
  combo_product_id uuid;
begin
  for s in
    select id,organization_id,combo
    from public.settings
    where organization_id is not null
  loop
    combo_name:=btrim(coalesce(s.combo->>'name',''));
    combo_description:=btrim(coalesce(s.combo->>'description',''));
    combo_image:=btrim(coalesce(nullif(s.combo->>'image',''),nullif(s.combo->>'emoji',''),'🍟🥤'));

    begin
      combo_price:=nullif(s.combo->>'price','')::numeric;
    exception when invalid_text_representation then
      combo_price:=null;
    end;

    if combo_name='' or combo_price is null or combo_price<=0 or combo_price>1000000 then
      continue;
    end if;

    combo_product_id:=null;
    if nullif(s.combo->>'product_id','') is not null then
      begin
        combo_product_id:=(s.combo->>'product_id')::uuid;
      exception when invalid_text_representation then
        combo_product_id:=null;
      end;
    end if;

    if combo_product_id is not null
       and not exists(
         select 1 from public.products p
         where p.id=combo_product_id
           and p.organization_id=s.organization_id
           and coalesce(p.is_combo,false)=true
       ) then
      combo_product_id:=null;
    end if;

    if combo_product_id is null then
      select p.id
        into combo_product_id
      from public.products p
      where p.organization_id=s.organization_id
        and coalesce(p.is_combo,false)=true
        and p.category='visionfood_combo'
      order by p.created_at
      limit 1;
    end if;

    if combo_product_id is null then
      insert into public.products(
        organization_id,name,price,category,image,description,
        removable_ingredients,extras,ingredients,is_combo,available,
        sold_by_weight,manage_stock,stock_quantity,ingredient_stock_blocked
      )
      values(
        s.organization_id,
        'Combo: '||combo_name,
        round(combo_price,2),
        'visionfood_combo',
        combo_image,
        combo_description,
        '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,true,
        false,false,0,false
      )
      returning id into combo_product_id;
    else
      update public.products
         set name='Combo: '||combo_name,
             price=round(combo_price,2),
             category='visionfood_combo',
             image=combo_image,
             description=combo_description,
             is_combo=true,
             available=true,
             sold_by_weight=false,
             manage_stock=false,
             ingredient_stock_blocked=false,
             updated_at=now()
       where id=combo_product_id
         and organization_id=s.organization_id;
    end if;

    update public.settings
       set combo=coalesce(s.combo,'{}'::jsonb)
          || jsonb_build_object('product_id',combo_product_id),
           updated_at=now()
     where id=s.id;
  end loop;
end
$do$;
