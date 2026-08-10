GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_authenticated_write" ON public.settings;
CREATE POLICY "settings_authenticated_write"
ON public.settings
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_authenticated_write" ON public.products;
CREATE POLICY "products_authenticated_write"
ON public.products
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

DO $migration$
BEGIN
  IF to_regclass('public.categorias') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorias TO authenticated';
    EXECUTE 'GRANT ALL ON public.categorias TO service_role';
    EXECUTE 'ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "categorias_authenticated_write" ON public.categorias';
    EXECUTE 'CREATE POLICY "categorias_authenticated_write" ON public.categorias FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;

  IF to_regclass('public.produtos') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos TO authenticated';
    EXECUTE 'GRANT ALL ON public.produtos TO service_role';
    EXECUTE 'ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "produtos_authenticated_write" ON public.produtos';
    EXECUTE 'CREATE POLICY "produtos_authenticated_write" ON public.produtos FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END
$migration$;

NOTIFY pgrst, 'reload schema';