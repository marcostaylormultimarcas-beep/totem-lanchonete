-- PHASE 250: create_order_checkout_v3 is used only after customer authentication.
-- Keep SECURITY DEFINER, but remove anonymous execution to match the current kiosk flow.
revoke execute on function public.create_order_checkout_v3(
  uuid,text,text,text,text,text,text,text,uuid,text,numeric,jsonb,numeric,text,timestamptz,text,jsonb
) from anon;
