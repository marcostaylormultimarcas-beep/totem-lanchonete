
-- 1. Configuração por loja
CREATE TABLE public.vision_prime_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT false,
  valor_mensalidade numeric NOT NULL DEFAULT 19.90,
  desconto_percentual numeric NOT NULL DEFAULT 10,
  frete_gratis_minimo numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vision_prime_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vision_prime_config public read" ON public.vision_prime_config
  FOR SELECT USING (true);

CREATE POLICY "vision_prime_config owner manage" ON public.vision_prime_config
  FOR ALL USING (
    is_super_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = vision_prime_config.organization_id
        AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  ) WITH CHECK (
    is_super_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = vision_prime_config.organization_id
        AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

CREATE TRIGGER vision_prime_config_updated
  BEFORE UPDATE ON public.vision_prime_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Assinaturas dos clientes
CREATE TABLE public.vision_prime_assinaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
ALTER TABLE public.vision_prime_assinaturas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prime own select" ON public.vision_prime_assinaturas
  FOR SELECT USING (
    auth.uid() = user_id
    OR is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = vision_prime_assinaturas.organization_id
        AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

CREATE POLICY "prime own insert" ON public.vision_prime_assinaturas
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "prime own update" ON public.vision_prime_assinaturas
  FOR UPDATE USING (
    auth.uid() = user_id
    OR is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = vision_prime_assinaturas.organization_id
        AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

CREATE TRIGGER vision_prime_assinaturas_updated
  BEFORE UPDATE ON public.vision_prime_assinaturas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Feature global para super admin liberar por plano
INSERT INTO public.features (key, name, description, category, sort_order)
VALUES ('vision_prime', 'Clube Vision Prime', 'Clube de assinatura premium (mensalidade, desconto fixo e frete grátis).', 'fidelizacao', 100)
ON CONFLICT (key) DO NOTHING;

-- 4. RPC: assinar
CREATE OR REPLACE FUNCTION public.vision_prime_subscribe(_org uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cfg public.vision_prime_config%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  SELECT * INTO v_cfg FROM public.vision_prime_config WHERE organization_id = _org;
  IF NOT FOUND OR NOT v_cfg.ativo THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;

  INSERT INTO public.vision_prime_assinaturas (organization_id, user_id, status, started_at, expires_at)
  VALUES (_org, v_uid, 'active', now(), now() + interval '30 days')
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET status = 'active', started_at = COALESCE(public.vision_prime_assinaturas.started_at, now()),
                expires_at = now() + interval '30 days', updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 5. RPC: status atual
CREATE OR REPLACE FUNCTION public.vision_prime_my_status(_org uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.vision_prime_assinaturas%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('active', false);
  END IF;
  SELECT * INTO v_row FROM public.vision_prime_assinaturas
    WHERE organization_id = _org AND user_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('active', false); END IF;
  IF v_row.status = 'active' AND (v_row.expires_at IS NULL OR v_row.expires_at > now()) THEN
    RETURN jsonb_build_object(
      'active', true,
      'since_year', EXTRACT(YEAR FROM v_row.started_at)::int,
      'expires_at', v_row.expires_at
    );
  END IF;
  RETURN jsonb_build_object('active', false);
END;
$$;
