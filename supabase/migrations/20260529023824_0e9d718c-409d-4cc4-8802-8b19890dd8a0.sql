
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS onesignal_app_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS onesignal_api_key text NOT NULL DEFAULT '';

-- Bucket público para logos (idempotente)
INSERT INTO storage.buckets (id, name, public)
VALUES ('store-logos', 'store-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='store-logos public read'
  ) THEN
    CREATE POLICY "store-logos public read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'store-logos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='store-logos auth upload'
  ) THEN
    CREATE POLICY "store-logos auth upload"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'store-logos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='store-logos auth update'
  ) THEN
    CREATE POLICY "store-logos auth update"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (bucket_id = 'store-logos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='store-logos auth delete'
  ) THEN
    CREATE POLICY "store-logos auth delete"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (bucket_id = 'store-logos');
  END IF;
END $$;
