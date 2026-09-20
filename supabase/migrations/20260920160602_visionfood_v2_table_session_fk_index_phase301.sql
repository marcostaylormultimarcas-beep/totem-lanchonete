-- PHASE 301: post-activation performance follow-up.
--
-- Audited the four INFO unindexed-FK findings introduced/observed after
-- PHASE 290/292/293 activation. Only orders.table_session_id has a real
-- query path that filters by the FK without organization_id:
-- public.visionfood_close_table_session(_session_id).
--
-- The existing orders_org_table_session_idx starts with organization_id,
-- so it does not cover the session-only lookup as a leading-key index.
--
-- The other three INFO findings are intentionally left unchanged in PHASE 301:
-- - private.kiosk_device_enrollments.target_device_id
-- - private.kiosk_order_syncs.order_id
-- - public.orders.table_id
-- No active runtime query filters/joins those child tables by those FK columns.
-- Avoid adding write/storage overhead without a demonstrated query pattern.
--
-- This migration changes no authorization, ownership, sync, checkout,
-- enrollment, or device-owned offline semantics.

create index if not exists orders_table_session_id_idx
  on public.orders(table_session_id)
  where table_session_id is not null;
