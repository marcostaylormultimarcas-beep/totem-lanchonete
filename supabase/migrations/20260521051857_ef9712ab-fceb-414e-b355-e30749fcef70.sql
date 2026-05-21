
-- 1. Cidade nas lojas
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '';

-- 2. Feature Co-Marketing
INSERT INTO public.features (key, name, description, category, sort_order)
VALUES ('co_marketing', 'Co-Marketing Hub', 'Permite criar parcerias entre lojas e gerar cupons cruzados.', 'marketing', 100)
ON CONFLICT (key) DO NOTHING;

-- 3. Parcerias
CREATE TABLE IF NOT EXISTS public.parcerias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_origem uuid NOT NULL,           -- quem solicitou
  org_parceira uuid NOT NULL,         -- quem recebe o convite e dá a recompensa
  status text NOT NULL DEFAULT 'pending', -- pending | active | declined | suspended
  min_order_value numeric NOT NULL DEFAULT 50,
  discount_percent numeric NOT NULL DEFAULT 10,
  habilitada_origem boolean NOT NULL DEFAULT true,
  habilitada_parceira boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parcerias_distinct CHECK (org_origem <> org_parceira),
  CONSTRAINT parcerias_unique UNIQUE (org_origem, org_parceira)
);
ALTER TABLE public.parcerias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parcerias public read"
  ON public.parcerias FOR SELECT USING (true);

CREATE POLICY "parcerias owner manage"
  ON public.parcerias FOR ALL
  USING (
    public.is_super_admin(auth.uid())
    OR public.user_owns_org(org_origem, auth.uid())
    OR public.user_owns_org(org_parceira, auth.uid())
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.user_owns_org(org_origem, auth.uid())
    OR public.user_owns_org(org_parceira, auth.uid())
  );

-- 4. Cupons gerados por parceria
CREATE TABLE IF NOT EXISTS public.parceria_cupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id uuid NOT NULL REFERENCES public.parcerias(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  org_origem uuid NOT NULL,
  org_parceira uuid NOT NULL,
  codigo text NOT NULL UNIQUE,
  discount_percent numeric NOT NULL,
  customer_phone text NOT NULL DEFAULT '',
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.parceria_cupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parceria_cupons public read"
  ON public.parceria_cupons FOR SELECT USING (true);

-- 5. RPCs

CREATE OR REPLACE FUNCTION public.parceria_request(_org_origem uuid, _org_parceira uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
  IF NOT public.user_owns_org(_org_origem, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF NOT public.org_has_feature(_org_origem, 'co_marketing') AND NOT public.is_super_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_locked');
  END IF;
  INSERT INTO public.parcerias (org_origem, org_parceira, status)
    VALUES (_org_origem, _org_parceira, 'pending')
    ON CONFLICT (org_origem, org_parceira) DO UPDATE
      SET status = CASE WHEN public.parcerias.status = 'declined' THEN 'pending' ELSE public.parcerias.status END,
          updated_at = now()
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;$$;

CREATE OR REPLACE FUNCTION public.parceria_respond(_parceria_id uuid, _accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.parcerias%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
  SELECT * INTO v_row FROM public.parcerias WHERE id = _parceria_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT public.user_owns_org(v_row.org_parceira, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  UPDATE public.parcerias
    SET status = CASE WHEN _accept THEN 'active' ELSE 'declined' END,
        updated_at = now()
    WHERE id = _parceria_id;
  RETURN jsonb_build_object('ok', true);
END;$$;

CREATE OR REPLACE FUNCTION public.parceria_set_rules(_parceria_id uuid, _min_order numeric, _discount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.parcerias%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
  SELECT * INTO v_row FROM public.parcerias WHERE id = _parceria_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT (public.user_owns_org(v_row.org_origem, v_uid) OR public.user_owns_org(v_row.org_parceira, v_uid)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  UPDATE public.parcerias
    SET min_order_value = GREATEST(_min_order, 0),
        discount_percent = LEAST(GREATEST(_discount, 0), 100),
        updated_at = now()
    WHERE id = _parceria_id;
  RETURN jsonb_build_object('ok', true);
END;$$;

CREATE OR REPLACE FUNCTION public.parceria_toggle(_parceria_id uuid, _enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.parcerias%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
  SELECT * INTO v_row FROM public.parcerias WHERE id = _parceria_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF public.user_owns_org(v_row.org_origem, v_uid) THEN
    UPDATE public.parcerias SET habilitada_origem = _enabled, updated_at = now() WHERE id = _parceria_id;
  ELSIF public.user_owns_org(v_row.org_parceira, v_uid) THEN
    UPDATE public.parcerias SET habilitada_parceira = _enabled, updated_at = now() WHERE id = _parceria_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;$$;

-- Gera cupom de parceria quando um pedido finalizado atinge o mínimo
CREATE OR REPLACE FUNCTION public.parceria_generate_for_order(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_p public.parcerias%ROWTYPE;
  v_code text;
  v_cupom_id uuid;
  v_org_parc_name text;
  v_org_parc_slug text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  -- Procura parceria ativa onde esta loja é origem
  SELECT * INTO v_p FROM public.parcerias
    WHERE org_origem = v_order.organization_id
      AND status = 'active'
      AND habilitada_origem = true
      AND habilitada_parceira = true
    ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_partnership'); END IF;

  -- Verifica feature em ambos os lados
  IF NOT public.org_has_feature(v_p.org_origem, 'co_marketing')
     OR NOT public.org_has_feature(v_p.org_parceira, 'co_marketing') THEN
    UPDATE public.parcerias SET status = 'suspended', updated_at = now() WHERE id = v_p.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_suspended');
  END IF;

  IF v_order.total < v_p.min_order_value THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'below_minimum');
  END IF;

  -- Evita duplicar pra mesmo pedido
  SELECT id, codigo INTO v_cupom_id, v_code FROM public.parceria_cupons WHERE order_id = _order_id LIMIT 1;
  IF v_cupom_id IS NULL THEN
    v_code := 'PRC-' || upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 8));
    INSERT INTO public.parceria_cupons (parceria_id, order_id, org_origem, org_parceira, codigo, discount_percent, customer_phone)
    VALUES (v_p.id, _order_id, v_p.org_origem, v_p.org_parceira, v_code, v_p.discount_percent, COALESCE(v_order.customer_phone,''))
    RETURNING id INTO v_cupom_id;
  END IF;

  SELECT name, slug INTO v_org_parc_name, v_org_parc_slug FROM public.organizations WHERE id = v_p.org_parceira;

  RETURN jsonb_build_object(
    'ok', true,
    'codigo', v_code,
    'discount_percent', v_p.discount_percent,
    'partner_name', v_org_parc_name,
    'partner_slug', v_org_parc_slug
  );
END;$$;

-- Suspende parcerias quando perde a feature
CREATE OR REPLACE FUNCTION public.parceria_sweep_suspended()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; cnt int := 0;
BEGIN
  FOR r IN SELECT id, org_origem, org_parceira FROM public.parcerias WHERE status = 'active' LOOP
    IF NOT public.org_has_feature(r.org_origem, 'co_marketing')
       OR NOT public.org_has_feature(r.org_parceira, 'co_marketing') THEN
      UPDATE public.parcerias SET status = 'suspended', updated_at = now() WHERE id = r.id;
      cnt := cnt + 1;
    END IF;
  END LOOP;
  RETURN cnt;
END;$$;
