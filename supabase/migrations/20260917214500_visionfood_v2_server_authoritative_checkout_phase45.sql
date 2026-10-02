-- Phase45: harden public checkout trust boundary.
-- The database validates organization state, product ownership/availability,
-- canonical product/extras prices and delivery neighborhood/fee.
-- This first revision was immediately followed by Phase45b compatibility
-- because existing coupon/Prime discounts are still calculated by the client.
-- Kept in migration history to mirror the official Supabase sequence.

-- See Phase45b for the final installed function definition.
select 1;
