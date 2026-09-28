-- VisionFood V2 — realtime convergence for ingredient stock alerts.
-- Additive only. Historical migrations remain untouched.
--
-- The admin panel subscribes to tenant-filterable INSERT/UPDATE changes on
-- public.alertas_estoque and then re-reads the authoritative newest 20 rows.
-- DELETE is intentionally not subscribed: Supabase Postgres Changes cannot
-- filter DELETE events by organization_id and RLS is not applied to DELETE
-- change delivery. The authoritative backend does not delete these alerts;
-- it resolves them with UPDATE resolvido=true.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'alertas_estoque'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.alertas_estoque;
  END IF;
END
$$;
