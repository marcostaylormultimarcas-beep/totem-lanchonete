
-- =====================
-- PLANS
-- =====================
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans public read" ON public.plans FOR SELECT USING (true);
CREATE POLICY "plans super manage" ON public.plans FOR ALL
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================
-- FEATURES
-- =====================
CREATE TABLE public.features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'geral',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "features public read" ON public.features FOR SELECT USING (true);
CREATE POLICY "features super manage" ON public.features FOR ALL
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE TRIGGER trg_features_updated BEFORE UPDATE ON public.features
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================
-- PLAN_FEATURES (matriz)
-- =====================
CREATE TABLE public.plan_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, feature_id)
);
CREATE INDEX idx_plan_features_plan ON public.plan_features(plan_id);
ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_features public read" ON public.plan_features FOR SELECT USING (true);
CREATE POLICY "plan_features super manage" ON public.plan_features FOR ALL
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE TRIGGER trg_plan_features_updated BEFORE UPDATE ON public.plan_features
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================
-- AUDIT LOG
-- =====================
CREATE TABLE public.plan_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text NOT NULL DEFAULT '',
  plan_id uuid,
  plan_key text NOT NULL DEFAULT '',
  plan_name text NOT NULL DEFAULT '',
  feature_id uuid,
  feature_key text NOT NULL DEFAULT '',
  feature_name text NOT NULL DEFAULT '',
  action text NOT NULL,
  previous_value boolean,
  new_value boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_plan_audit_created ON public.plan_audit_log(created_at DESC);
ALTER TABLE public.plan_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit super read" ON public.plan_audit_log FOR SELECT
  USING (is_super_admin(auth.uid()));
-- Sem políticas de insert/update/delete: só via SECURITY DEFINER

-- =====================
-- ORGANIZATIONS.plan_id
-- =====================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL;

-- =====================
-- SEED
-- =====================
INSERT INTO public.plans (key, name, description, sort_order) VALUES
  ('web', 'Plano Web', 'Cardápio online + pedidos via app', 1),
  ('totem', 'Plano Totem', 'Autoatendimento em loja física', 2),
  ('premium', 'Plano Premium', 'Tudo incluso: web, totem e recursos avançados', 3)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.features (key, name, description, category, sort_order) VALUES
  ('print_receipt', 'Impressão de Comanda', 'Imprimir comprovantes de pedidos', 'operacao', 1),
  ('loyalty', 'Programa de Fidelidade', 'Carimbos e recompensas para clientes', 'engajamento', 2),
  ('coupons', 'Cupons de Desconto', 'Criar e gerenciar cupons promocionais', 'engajamento', 3),
  ('crm', 'CRM de Clientes', 'Base de clientes e histórico', 'engajamento', 4),
  ('mercadopago', 'Mercado Pago / PIX', 'Pagamento online integrado', 'pagamento', 5),
  ('fiscal', 'Emissão Fiscal (NFC-e)', 'Notas fiscais eletrônicas', 'fiscal', 6),
  ('banners', 'Banners Promocionais', 'Banners no totem e no cardápio', 'marketing', 7),
  ('combos', 'Combos & Upsell', 'Promoções e venda casada', 'marketing', 8),
  ('order_history', 'Histórico de Pedidos do Cliente', 'Cliente vê seus pedidos antigos', 'engajamento', 9),
  ('delivery', 'Pedidos para Entrega', 'Aceitar pedidos delivery', 'operacao', 10)
ON CONFLICT (key) DO NOTHING;

-- Matriz padrão por plano
DO $$
DECLARE
  p_web uuid;  p_tot uuid;  p_prem uuid;
  f record;
  web_features text[]  := ARRAY['coupons','loyalty','mercadopago','banners','order_history','delivery','combos'];
  tot_features text[]  := ARRAY['print_receipt','loyalty','banners','combos','coupons'];
BEGIN
  SELECT id INTO p_web  FROM public.plans WHERE key='web';
  SELECT id INTO p_tot  FROM public.plans WHERE key='totem';
  SELECT id INTO p_prem FROM public.plans WHERE key='premium';

  FOR f IN SELECT id, key FROM public.features LOOP
    INSERT INTO public.plan_features (plan_id, feature_id, enabled)
      VALUES (p_web, f.id, f.key = ANY(web_features))
      ON CONFLICT (plan_id, feature_id) DO NOTHING;
    INSERT INTO public.plan_features (plan_id, feature_id, enabled)
      VALUES (p_tot, f.id, f.key = ANY(tot_features))
      ON CONFLICT (plan_id, feature_id) DO NOTHING;
    -- Premium libera tudo
    INSERT INTO public.plan_features (plan_id, feature_id, enabled)
      VALUES (p_prem, f.id, true)
      ON CONFLICT (plan_id, feature_id) DO NOTHING;
  END LOOP;

  -- Lojas sem plano → Plano Web por padrão
  UPDATE public.organizations SET plan_id = p_web WHERE plan_id IS NULL;
END $$;

-- =====================
-- RPC: toggle_plan_feature
-- =====================
CREATE OR REPLACE FUNCTION public.toggle_plan_feature(_plan_id uuid, _feature_id uuid, _enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := '';
  v_prev boolean;
  v_plan public.plans%ROWTYPE;
  v_feat public.features%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF NOT public.is_super_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = _plan_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_found'); END IF;

  SELECT * INTO v_feat FROM public.features WHERE id = _feature_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'feature_not_found'); END IF;

  SELECT enabled INTO v_prev FROM public.plan_features
    WHERE plan_id = _plan_id AND feature_id = _feature_id;

  INSERT INTO public.plan_features (plan_id, feature_id, enabled)
    VALUES (_plan_id, _feature_id, _enabled)
    ON CONFLICT (plan_id, feature_id)
    DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();

  IF v_prev IS DISTINCT FROM _enabled THEN
    BEGIN
      SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    EXCEPTION WHEN others THEN v_email := ''; END;

    INSERT INTO public.plan_audit_log
      (actor_id, actor_email, plan_id, plan_key, plan_name, feature_id, feature_key, feature_name, action, previous_value, new_value)
    VALUES
      (v_uid, COALESCE(v_email,''), _plan_id, v_plan.key, v_plan.name, _feature_id, v_feat.key, v_feat.name,
       CASE WHEN _enabled THEN 'enabled' ELSE 'disabled' END,
       v_prev, _enabled);
  END IF;

  RETURN jsonb_build_object('ok', true, 'previous', v_prev, 'new', _enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_plan_feature(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_plan_feature(uuid, uuid, boolean) TO authenticated;

-- =====================
-- RPC: org_has_feature
-- =====================
CREATE OR REPLACE FUNCTION public.org_has_feature(_org uuid, _feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT pf.enabled
       FROM public.organizations o
       JOIN public.plan_features pf ON pf.plan_id = o.plan_id
       JOIN public.features f ON f.id = pf.feature_id
      WHERE o.id = _org AND f.key = _feature_key
      LIMIT 1),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.org_has_feature(uuid, text) TO anon, authenticated;
