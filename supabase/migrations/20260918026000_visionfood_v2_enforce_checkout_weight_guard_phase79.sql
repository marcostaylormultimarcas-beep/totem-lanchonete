-- Phase 79: enforce the forged-weight guard in the authoritative quote and current 16-arg checkout.
do $$ declare f text; begin
 select pg_get_functiondef('public.quote_order_checkout(uuid,text,uuid,numeric,jsonb,text)'::regprocedure) into f;
 f:=replace(f,E'begin\n select * into _org',E'begin\n perform public.visionfood_assert_checkout_item_weights(_organization_id,_items);\n select * into _org');
 execute f;
 select pg_get_functiondef('public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamp with time zone,text)'::regprocedure) into f;
 f:=replace(f,E'begin\n select * into _org',E'begin\n perform public.visionfood_assert_checkout_item_weights(_organization_id,_items);\n select * into _org');
 execute f;
end $$;
