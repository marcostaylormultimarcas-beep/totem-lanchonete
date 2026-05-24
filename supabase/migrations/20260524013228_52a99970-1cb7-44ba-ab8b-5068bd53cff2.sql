-- Settings: campos de área de atendimento por CEP
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS cep_loja text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cep_lat numeric,
  ADD COLUMN IF NOT EXISTS cep_lng numeric,
  ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'bairros',
  ADD COLUMN IF NOT EXISTS delivery_raio_km numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS delivery_taxa_base numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS delivery_taxa_por_km numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS delivery_tempo_base_min integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS delivery_tempo_por_km_min numeric NOT NULL DEFAULT 3;

-- Orders: CEP e distância
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_cep text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_distance_km numeric;

-- Tabela de CEPs atendidos (modo lista)
CREATE TABLE IF NOT EXISTS public.cep_atendidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  cep text NOT NULL,
  taxa numeric NOT NULL DEFAULT 0,
  tempo_min integer NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, cep)
);

ALTER TABLE public.cep_atendidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cep_atendidos public read"
  ON public.cep_atendidos FOR SELECT USING (true);

CREATE POLICY "cep_atendidos owner manage"
  ON public.cep_atendidos FOR ALL
  USING (
    is_super_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = cep_atendidos.organization_id
        AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  )
  WITH CHECK (
    is_super_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = cep_atendidos.organization_id
        AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

CREATE TRIGGER trg_cep_atendidos_updated
  BEFORE UPDATE ON public.cep_atendidos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Função para validar entrega por CEP (3 modos)
CREATE OR REPLACE FUNCTION public.validar_cep_entrega(
  _org uuid, _cep text, _lat numeric DEFAULT NULL, _lng numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.settings%ROWTYPE;
  v_cep_norm text;
  v_row public.cep_atendidos%ROWTYPE;
  v_dist numeric;
  v_taxa numeric;
  v_tempo integer;
BEGIN
  v_cep_norm := regexp_replace(COALESCE(_cep,''), '\D', '', 'g');
  IF length(v_cep_norm) <> 8 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'cep_invalido');
  END IF;

  SELECT * INTO v_s FROM public.settings WHERE organization_id = _org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_configuracao');
  END IF;

  -- Modo: lista de CEPs
  IF v_s.delivery_mode = 'lista_ceps' THEN
    SELECT * INTO v_row FROM public.cep_atendidos
      WHERE organization_id = _org AND cep = v_cep_norm;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'fora_da_area');
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'motivo', 'ok',
      'taxa', v_row.taxa, 'tempo_min', v_row.tempo_min, 'distancia_km', NULL
    );
  END IF;

  -- Modo: raio em km (Haversine)
  IF v_s.delivery_mode = 'raio_km' THEN
    IF v_s.cep_lat IS NULL OR v_s.cep_lng IS NULL OR _lat IS NULL OR _lng IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'sem_coordenadas');
    END IF;
    v_dist := 2 * 6371 * asin(sqrt(
      sin(radians((_lat - v_s.cep_lat)/2))^2
      + cos(radians(v_s.cep_lat)) * cos(radians(_lat))
      * sin(radians((_lng - v_s.cep_lng)/2))^2
    ));
    IF v_dist > v_s.delivery_raio_km THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'fora_do_raio', 'distancia_km', round(v_dist::numeric, 2));
    END IF;
    v_taxa := round((v_s.delivery_taxa_base + v_s.delivery_taxa_por_km * v_dist)::numeric, 2);
    v_tempo := ceil(v_s.delivery_tempo_base_min + v_s.delivery_tempo_por_km_min * v_dist)::int;
    RETURN jsonb_build_object(
      'ok', true, 'motivo', 'ok',
      'taxa', v_taxa, 'tempo_min', v_tempo, 'distancia_km', round(v_dist::numeric, 2)
    );
  END IF;

  -- Modo: bairros (fallback / compatibilidade)
  RETURN jsonb_build_object('ok', true, 'motivo', 'bairros', 'taxa', NULL, 'tempo_min', NULL, 'distancia_km', NULL);
END;
$$;