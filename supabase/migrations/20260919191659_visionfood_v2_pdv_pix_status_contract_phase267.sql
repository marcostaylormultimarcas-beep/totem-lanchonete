-- VisionFood V2 PHASE 267
-- Align pdv_pix_intents.status with the states already written by
-- public.pdv_update_pix_payment_internal().
--
-- The live updater writes:
--   approved -> paid
--   rejected/cancelled/refunded/charged_back -> failed
-- but the existing CHECK constraint does not allow either value, causing the
-- payment status update to fail before pdv_pix_status_v2 can observe it.

ALTER TABLE public.pdv_pix_intents
  DROP CONSTRAINT IF EXISTS pdv_pix_intents_status_check;

ALTER TABLE public.pdv_pix_intents
  ADD CONSTRAINT pdv_pix_intents_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'pending'::text,
        'payment_created'::text,
        'paid'::text,
        'failed'::text,
        'consumed'::text,
        'cancelled'::text,
        'expired'::text
      ]
    )
  );
