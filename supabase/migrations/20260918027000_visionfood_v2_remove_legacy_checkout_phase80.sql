-- Phase 80: remove the obsolete 15-argument checkout overload.
-- It had no anon/authenticated EXECUTE grants and no database dependents.
-- The supported checkout is the 16-argument version with coupon + authoritative quote/weight guard.
drop function if exists public.create_order_checkout(
 uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamp with time zone
);
