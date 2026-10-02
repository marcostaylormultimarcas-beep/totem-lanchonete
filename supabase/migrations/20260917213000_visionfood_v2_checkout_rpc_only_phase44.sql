-- VisionFood V2 Phase 44
-- Force public checkout creation through the validated atomic RPC.
-- Direct table INSERT bypassed create_order_checkout and its validation/numbering contract.

DROP POLICY IF EXISTS "visionfood public create orders" ON public.orders;

REVOKE INSERT ON TABLE public.orders FROM anon;
REVOKE INSERT ON TABLE public.orders FROM authenticated;

-- The kiosk checkout is intentionally callable by public clients.
-- Keep its exposure explicit rather than inherited through PUBLIC.
REVOKE EXECUTE ON FUNCTION public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_checkout(uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz) TO anon, authenticated;
