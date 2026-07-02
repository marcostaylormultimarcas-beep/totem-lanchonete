CREATE TABLE public.teste_conexao (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resultado TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teste_conexao TO authenticated;
GRANT ALL ON public.teste_conexao TO service_role;
GRANT SELECT ON public.teste_conexao TO anon;

ALTER TABLE public.teste_conexao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage test rows"
ON public.teste_conexao
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Anyone can read test rows"
ON public.teste_conexao
FOR SELECT
TO anon
USING (true);