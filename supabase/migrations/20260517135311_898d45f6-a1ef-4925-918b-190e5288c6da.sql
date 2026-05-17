
ALTER TABLE public.config_fidelidade
  ADD COLUMN IF NOT EXISTS premio_imagem text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS descricao_premio text NOT NULL DEFAULT '';

CREATE TABLE public.pedidos_carimbados (
  order_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  telefone_cliente text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pedidos_carimbados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pedidos_carimbados owner read"
ON public.pedidos_carimbados FOR SELECT USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = pedidos_carimbados.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

CREATE TABLE public.resgates_fidelidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  telefone_cliente text NOT NULL,
  premio_texto text NOT NULL,
  premio_imagem text NOT NULL DEFAULT '',
  codigo_resgate text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pendente',
  used_at timestamptz,
  used_by_user uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_resgates_org_phone ON public.resgates_fidelidade(organization_id, telefone_cliente);
ALTER TABLE public.resgates_fidelidade ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read resgates"
ON public.resgates_fidelidade FOR SELECT USING (true);

CREATE POLICY "resgates owner manage"
ON public.resgates_fidelidade FOR ALL
USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = resgates_fidelidade.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
)
WITH CHECK (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = resgates_fidelidade.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

-- Endurecimento: remover policies permissivas
DROP POLICY IF EXISTS "Public insert progresso_fidelidade" ON public.progresso_fidelidade;
DROP POLICY IF EXISTS "Public update progresso_fidelidade" ON public.progresso_fidelidade;

-- Função segura que carimba (uso exclusivo do painel do lojista)
CREATE OR REPLACE FUNCTION public.grant_loyalty_stamp(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_cfg public.config_fidelidade%ROWTYPE;
  v_prog public.progresso_fidelidade%ROWTYPE;
  v_phone text;
  v_meta int;
  v_novo int;
  v_premios int;
  v_resgate_id uuid;
  v_codigo text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  IF NOT (is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = v_order.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF v_order.status <> 'delivered' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_delivered');
  END IF;

  SELECT * INTO v_cfg FROM public.config_fidelidade WHERE organization_id = v_order.organization_id;
  IF NOT FOUND OR NOT v_cfg.ativo THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;

  IF v_order.total < v_cfg.valor_minimo_pedido THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'below_minimum');
  END IF;

  v_phone := regexp_replace(coalesce(v_order.customer_phone, ''), '\D', '', 'g');
  IF length(v_phone) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_phone');
  END IF;

  BEGIN
    INSERT INTO public.pedidos_carimbados (order_id, organization_id, telefone_cliente)
      VALUES (_order_id, v_order.organization_id, v_phone);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_stamped');
  END;

  SELECT * INTO v_prog FROM public.progresso_fidelidade
    WHERE organization_id = v_order.organization_id AND telefone_cliente = v_phone;

  v_meta := GREATEST(1, v_cfg.meta_pedidos);
  v_premios := COALESCE(v_prog.premios_resgatados, 0);
  v_novo := COALESCE(v_prog.quantidade_carimbos, 0) + 1;

  IF v_novo >= v_meta THEN
    v_novo := 0;
    v_premios := v_premios + 1;
    v_codigo := 'FID-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));
    INSERT INTO public.resgates_fidelidade
      (organization_id, telefone_cliente, premio_texto, premio_imagem, codigo_resgate)
    VALUES
      (v_order.organization_id, v_phone, v_cfg.premio_recompensa, COALESCE(v_cfg.premio_imagem, ''), v_codigo)
    RETURNING id INTO v_resgate_id;
  END IF;

  IF v_prog.id IS NOT NULL THEN
    UPDATE public.progresso_fidelidade
      SET quantidade_carimbos = v_novo,
          premios_resgatados = v_premios,
          ultimo_pedido_id = _order_id,
          updated_at = now()
      WHERE id = v_prog.id;
  ELSE
    INSERT INTO public.progresso_fidelidade
      (organization_id, telefone_cliente, quantidade_carimbos, premios_resgatados, ultimo_pedido_id)
    VALUES
      (v_order.organization_id, v_phone, v_novo, v_premios, _order_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'carimbos', v_novo,
    'meta', v_meta,
    'completed', v_resgate_id IS NOT NULL,
    'resgate_id', v_resgate_id,
    'codigo', v_codigo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_loyalty_stamp(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_loyalty_stamp(uuid) TO authenticated;

-- Função segura para marcar prêmio como utilizado
CREATE OR REPLACE FUNCTION public.redeem_loyalty_prize(_resgate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r public.resgates_fidelidade%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_r FROM public.resgates_fidelidade WHERE id = _resgate_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  IF NOT (is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = v_r.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF v_r.status <> 'pendente' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_used');
  END IF;

  UPDATE public.resgates_fidelidade
    SET status = 'utilizado', used_at = now(), used_by_user = auth.uid()
    WHERE id = _resgate_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_loyalty_prize(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_prize(uuid) TO authenticated;
