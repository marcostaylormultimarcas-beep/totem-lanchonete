
-- ============ TABELAS ============

CREATE TABLE IF NOT EXISTS public.operadores_pdv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  username text NOT NULL,
  password text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, username)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operadores_pdv TO authenticated;
GRANT ALL ON public.operadores_pdv TO service_role;
ALTER TABLE public.operadores_pdv ENABLE ROW LEVEL SECURITY;

CREATE POLICY "op pdv select own org" ON public.operadores_pdv FOR SELECT TO authenticated
  USING (public.user_owns_org(organization_id, auth.uid()));
CREATE POLICY "op pdv insert own org" ON public.operadores_pdv FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_org(organization_id, auth.uid()));
CREATE POLICY "op pdv update own org" ON public.operadores_pdv FOR UPDATE TO authenticated
  USING (public.user_owns_org(organization_id, auth.uid()));
CREATE POLICY "op pdv delete own org" ON public.operadores_pdv FOR DELETE TO authenticated
  USING (public.user_owns_org(organization_id, auth.uid()));

CREATE TRIGGER trg_operadores_pdv_updated BEFORE UPDATE ON public.operadores_pdv
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Caixas (sessões)
CREATE TABLE IF NOT EXISTS public.caixas_pdv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  operador_id uuid NOT NULL REFERENCES public.operadores_pdv(id) ON DELETE RESTRICT,
  operador_nome text NOT NULL,
  saldo_inicial numeric(12,2) NOT NULL DEFAULT 0,
  saldo_final numeric(12,2),
  status text NOT NULL DEFAULT 'open', -- 'open' | 'closed'
  resumo jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS caixas_pdv_org_status_idx ON public.caixas_pdv(organization_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.caixas_pdv TO authenticated;
GRANT ALL ON public.caixas_pdv TO service_role;
ALTER TABLE public.caixas_pdv ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caixas select own org" ON public.caixas_pdv FOR SELECT TO authenticated
  USING (public.user_owns_org(organization_id, auth.uid()));
CREATE POLICY "caixas insert own org" ON public.caixas_pdv FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_org(organization_id, auth.uid()));
CREATE POLICY "caixas update own org" ON public.caixas_pdv FOR UPDATE TO authenticated
  USING (public.user_owns_org(organization_id, auth.uid()));
CREATE POLICY "caixas delete own org" ON public.caixas_pdv FOR DELETE TO authenticated
  USING (public.user_owns_org(organization_id, auth.uid()));

CREATE TRIGGER trg_caixas_pdv_updated BEFORE UPDATE ON public.caixas_pdv
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Movimentos
CREATE TABLE IF NOT EXISTS public.caixa_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caixa_id uuid NOT NULL REFERENCES public.caixas_pdv(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  operador_id uuid REFERENCES public.operadores_pdv(id) ON DELETE SET NULL,
  operador_nome text,
  tipo text NOT NULL, -- abertura|venda|sangria|suprimento|devolucao|fechamento
  forma_pagamento text, -- dinheiro|pix|cartao|outro
  valor numeric(12,2) NOT NULL DEFAULT 0,
  motivo text,
  order_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS caixa_mov_caixa_idx ON public.caixa_movimentos(caixa_id);
CREATE INDEX IF NOT EXISTS caixa_mov_org_idx ON public.caixa_movimentos(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.caixa_movimentos TO authenticated;
GRANT ALL ON public.caixa_movimentos TO service_role;
ALTER TABLE public.caixa_movimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caixa mov select own org" ON public.caixa_movimentos FOR SELECT TO authenticated
  USING (public.user_owns_org(organization_id, auth.uid()));
CREATE POLICY "caixa mov insert own org" ON public.caixa_movimentos FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_org(organization_id, auth.uid()));

-- ============ FUNÇÕES ============

CREATE OR REPLACE FUNCTION public.pdv_operador_login(_org_slug text, _username text, _password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org public.organizations%ROWTYPE; v_op public.operadores_pdv%ROWTYPE; v_caixa_id uuid;
BEGIN
  SELECT * INTO v_org FROM public.organizations WHERE slug = _org_slug LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'org_not_found'); END IF;
  SELECT * INTO v_op FROM public.operadores_pdv
    WHERE organization_id = v_org.id AND username = _username AND password = _password AND active = true LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials'); END IF;
  SELECT id INTO v_caixa_id FROM public.caixas_pdv
    WHERE organization_id = v_org.id AND operador_id = v_op.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'ok', true,
    'operador', jsonb_build_object(
      'id', v_op.id, 'name', v_op.name, 'username', v_op.username,
      'organization_id', v_op.organization_id, 'org_slug', v_org.slug, 'org_name', v_org.name
    ),
    'caixa_aberto_id', v_caixa_id
  );
END; $$;

CREATE OR REPLACE FUNCTION public.pdv_check(_operador_id uuid, _password text)
RETURNS public.operadores_pdv LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_op public.operadores_pdv%ROWTYPE;
BEGIN
  SELECT * INTO v_op FROM public.operadores_pdv
    WHERE id = _operador_id AND password = _password AND active = true LIMIT 1;
  RETURN v_op;
END; $$;

CREATE OR REPLACE FUNCTION public.pdv_abrir_caixa(_operador_id uuid, _password text, _saldo_inicial numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_op public.operadores_pdv%ROWTYPE; v_caixa_id uuid;
BEGIN
  v_op := public.pdv_check(_operador_id, _password);
  IF v_op.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials'); END IF;
  IF EXISTS (SELECT 1 FROM public.caixas_pdv WHERE operador_id = v_op.id AND status = 'open') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_open');
  END IF;
  INSERT INTO public.caixas_pdv (organization_id, operador_id, operador_nome, saldo_inicial, status)
    VALUES (v_op.organization_id, v_op.id, v_op.name, COALESCE(_saldo_inicial,0), 'open')
    RETURNING id INTO v_caixa_id;
  INSERT INTO public.caixa_movimentos (caixa_id, organization_id, operador_id, operador_nome, tipo, forma_pagamento, valor, motivo)
    VALUES (v_caixa_id, v_op.organization_id, v_op.id, v_op.name, 'abertura', 'dinheiro', COALESCE(_saldo_inicial,0), 'Saldo inicial (troco)');
  RETURN jsonb_build_object('ok', true, 'caixa_id', v_caixa_id);
END; $$;

CREATE OR REPLACE FUNCTION public.pdv_registrar_movimento(
  _operador_id uuid, _password text, _caixa_id uuid,
  _tipo text, _forma text, _valor numeric, _motivo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_op public.operadores_pdv%ROWTYPE; v_caixa public.caixas_pdv%ROWTYPE;
BEGIN
  v_op := public.pdv_check(_operador_id, _password);
  IF v_op.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials'); END IF;
  SELECT * INTO v_caixa FROM public.caixas_pdv WHERE id = _caixa_id;
  IF NOT FOUND OR v_caixa.status <> 'open' OR v_caixa.operador_id <> v_op.id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'caixa_invalido');
  END IF;
  IF _tipo NOT IN ('sangria','suprimento') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tipo_invalido');
  END IF;
  IF COALESCE(_valor,0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'valor_invalido'); END IF;
  INSERT INTO public.caixa_movimentos (caixa_id, organization_id, operador_id, operador_nome, tipo, forma_pagamento, valor, motivo)
    VALUES (_caixa_id, v_op.organization_id, v_op.id, v_op.name, _tipo, COALESCE(_forma,'dinheiro'), _valor, COALESCE(_motivo,''));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.pdv_registrar_venda(
  _operador_id uuid, _password text, _caixa_id uuid,
  _items jsonb, _forma text, _total numeric, _cupom_code text, _desconto numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_op public.operadores_pdv%ROWTYPE; v_caixa public.caixas_pdv%ROWTYPE; v_order_id uuid;
BEGIN
  v_op := public.pdv_check(_operador_id, _password);
  IF v_op.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials'); END IF;
  SELECT * INTO v_caixa FROM public.caixas_pdv WHERE id = _caixa_id;
  IF NOT FOUND OR v_caixa.status <> 'open' OR v_caixa.operador_id <> v_op.id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'caixa_invalido');
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_itens');
  END IF;

  INSERT INTO public.orders (
    organization_id, status, items, total, order_type, payment_method,
    customer_name, customer_phone, notes
  ) VALUES (
    v_op.organization_id, 'delivered', _items, COALESCE(_total,0), 'pdv', COALESCE(_forma,'dinheiro'),
    'Balcão', '', CASE WHEN COALESCE(_cupom_code,'') <> '' THEN 'Cupom: '||_cupom_code ELSE '' END
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.caixa_movimentos (caixa_id, organization_id, operador_id, operador_nome, tipo, forma_pagamento, valor, motivo, order_id, metadata)
    VALUES (_caixa_id, v_op.organization_id, v_op.id, v_op.name, 'venda', COALESCE(_forma,'dinheiro'), COALESCE(_total,0),
            CASE WHEN COALESCE(_cupom_code,'') <> '' THEN 'Cupom '||_cupom_code ELSE 'Venda PDV' END,
            v_order_id, jsonb_build_object('desconto', COALESCE(_desconto,0), 'cupom', COALESCE(_cupom_code,'')));

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id);
END; $$;

CREATE OR REPLACE FUNCTION public.pdv_devolver_pedido(
  _operador_id uuid, _password text, _caixa_id uuid,
  _order_id uuid, _items_devolvidos jsonb, _valor_devolucao numeric, _motivo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_op public.operadores_pdv%ROWTYPE; v_caixa public.caixas_pdv%ROWTYPE; v_order public.orders%ROWTYPE;
BEGIN
  v_op := public.pdv_check(_operador_id, _password);
  IF v_op.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials'); END IF;
  SELECT * INTO v_caixa FROM public.caixas_pdv WHERE id = _caixa_id;
  IF NOT FOUND OR v_caixa.status <> 'open' OR v_caixa.operador_id <> v_op.id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'caixa_invalido');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND OR v_order.organization_id <> v_op.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pedido_invalido');
  END IF;

  -- Restoca os itens devolvidos
  PERFORM public.restock_from_items(v_op.organization_id, _items_devolvidos);

  -- Registra saída em dinheiro do caixa
  INSERT INTO public.caixa_movimentos (caixa_id, organization_id, operador_id, operador_nome, tipo, forma_pagamento, valor, motivo, order_id, metadata)
    VALUES (_caixa_id, v_op.organization_id, v_op.id, v_op.name, 'devolucao', 'dinheiro', COALESCE(_valor_devolucao,0),
            COALESCE(_motivo,'Devolução'), _order_id, jsonb_build_object('itens', _items_devolvidos));

  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.pdv_fechar_caixa(_operador_id uuid, _password text, _caixa_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_op public.operadores_pdv%ROWTYPE; v_caixa public.caixas_pdv%ROWTYPE;
  v_din numeric := 0; v_pix numeric := 0; v_cart numeric := 0; v_outro numeric := 0;
  v_sangria numeric := 0; v_suprimento numeric := 0; v_devolucao numeric := 0;
  v_saldo_final numeric := 0; v_resumo jsonb;
BEGIN
  v_op := public.pdv_check(_operador_id, _password);
  IF v_op.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials'); END IF;
  SELECT * INTO v_caixa FROM public.caixas_pdv WHERE id = _caixa_id;
  IF NOT FOUND OR v_caixa.status <> 'open' OR v_caixa.operador_id <> v_op.id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'caixa_invalido');
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN tipo='venda' AND forma_pagamento='dinheiro' THEN valor ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN tipo='venda' AND forma_pagamento='pix' THEN valor ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN tipo='venda' AND forma_pagamento='cartao' THEN valor ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN tipo='venda' AND forma_pagamento NOT IN ('dinheiro','pix','cartao') THEN valor ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN tipo='sangria' THEN valor ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN tipo='devolucao' THEN valor ELSE 0 END),0)
  INTO v_din, v_pix, v_cart, v_outro, v_sangria, v_suprimento, v_devolucao
  FROM public.caixa_movimentos WHERE caixa_id = _caixa_id;

  v_saldo_final := v_caixa.saldo_inicial + v_din + v_suprimento - v_sangria - v_devolucao;

  v_resumo := jsonb_build_object(
    'saldo_inicial', v_caixa.saldo_inicial,
    'vendas_dinheiro', v_din, 'vendas_pix', v_pix, 'vendas_cartao', v_cart, 'vendas_outro', v_outro,
    'total_vendas', v_din + v_pix + v_cart + v_outro,
    'sangrias', v_sangria, 'suprimentos', v_suprimento, 'devolucoes', v_devolucao,
    'saldo_final_dinheiro', v_saldo_final
  );

  UPDATE public.caixas_pdv
    SET status='closed', saldo_final = v_saldo_final, resumo = v_resumo, closed_at = now(), updated_at = now()
    WHERE id = _caixa_id;

  INSERT INTO public.caixa_movimentos (caixa_id, organization_id, operador_id, operador_nome, tipo, forma_pagamento, valor, motivo, metadata)
    VALUES (_caixa_id, v_op.organization_id, v_op.id, v_op.name, 'fechamento', 'dinheiro', v_saldo_final, 'Fechamento de caixa', v_resumo);

  RETURN jsonb_build_object('ok', true, 'resumo', v_resumo);
END; $$;

-- Permissões EXECUTE
GRANT EXECUTE ON FUNCTION public.pdv_operador_login(text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_abrir_caixa(uuid,text,numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_registrar_movimento(uuid,text,uuid,text,text,numeric,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_registrar_venda(uuid,text,uuid,jsonb,text,numeric,text,numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_devolver_pedido(uuid,text,uuid,uuid,jsonb,numeric,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_fechar_caixa(uuid,text,uuid) TO anon, authenticated;
