-- Phase 54: public kiosk validates coupons only through validate_checkout_coupon.
drop policy if exists "public read cupons ativos" on public.cupons;
revoke select on public.cupons from anon;
