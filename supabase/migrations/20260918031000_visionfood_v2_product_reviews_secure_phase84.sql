-- Phase 84: restore product reviews with server-side purchase validation and safe public reads.
create table if not exists public.product_reviews (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 rating smallint not null check (rating between 1 and 5),
 comment text not null default '' check (char_length(comment)<=1000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(product_id,user_id,order_id)
);
create index if not exists idx_product_reviews_product_created on public.product_reviews(product_id,created_at desc);

alter table public.product_reviews enable row level security;
drop policy if exists reviews_public_read on public.product_reviews;
drop policy if exists reviews_insert_own on public.product_reviews;
drop policy if exists reviews_update_own on public.product_reviews;
drop policy if exists reviews_delete_own on public.product_reviews;
create policy reviews_public_safe_read on public.product_reviews for select to anon,authenticated using (true);

revoke all on table public.product_reviews from public,anon,authenticated;
grant select(id,product_id,rating,comment,created_at) on public.product_reviews to anon,authenticated;
grant all on table public.product_reviews to service_role;

create or replace function public.submit_product_review(
 _product_id uuid,_order_id uuid,_rating integer,_comment text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.orders%rowtype; p public.products%rowtype; rid uuid;
begin
 if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 if _rating is null or _rating<1 or _rating>5 then return jsonb_build_object('ok',false,'reason','invalid_rating'); end if;
 select * into p from public.products where id=_product_id;
 if not found then return jsonb_build_object('ok',false,'reason','product_not_found'); end if;
 select * into o from public.orders where id=_order_id and user_id=u for share;
 if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;
 if o.status<>'delivered' then return jsonb_build_object('ok',false,'reason','order_not_delivered'); end if;
 if o.organization_id<>p.organization_id then return jsonb_build_object('ok',false,'reason','organization_mismatch'); end if;
 if not exists (
   select 1 from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) it
   where coalesce(nullif(it->>'product_id','')::uuid,
                  nullif(it->>'productId','')::uuid,
                  nullif(it#>>'{product,id}','')::uuid)=_product_id
 ) then return jsonb_build_object('ok',false,'reason','product_not_in_order'); end if;
 insert into public.product_reviews(product_id,organization_id,user_id,order_id,rating,comment,updated_at)
 values(_product_id,p.organization_id,u,_order_id,_rating,left(btrim(coalesce(_comment,'')),1000),now())
 on conflict(product_id,user_id,order_id) do update
 set rating=excluded.rating,comment=excluded.comment,updated_at=now()
 returning id into rid;
 return jsonb_build_object('ok',true,'id',rid);
exception when invalid_text_representation then
 return jsonb_build_object('ok',false,'reason','invalid_order_items');
end$$;
revoke all on function public.submit_product_review(uuid,uuid,integer,text) from public,anon;
grant execute on function public.submit_product_review(uuid,uuid,integer,text) to authenticated;
