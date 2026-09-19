-- VisionFood V2 — Painel de Senhas realtime fix
-- The TV subscribes to INSERTs on public.senhas_chamadas, therefore the table
-- must be part of the Supabase Realtime publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'senhas_chamadas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.senhas_chamadas;
  END IF;
END
$$;
