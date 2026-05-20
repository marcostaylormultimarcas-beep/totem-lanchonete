-- 1) Colunas de reembolso em orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS status_reembolso text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS data_reembolso timestamptz;

-- valores permitidos: 'none' | 'auto_eligible' | 'manual_required' | 'processing' | 'refunded' | 'failed'

-- 2) Tabela de log de cancelamentos
CREATE TABLE IF NOT EXISTS public.order_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  cancelled_by uuid,           -- auth.uid() ou NULL se sistema
  cancelled_by_kind text NOT NULL, -- 'system' | 'admin' | 'owner'
  previous_status text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_cancellations_org ON public.order_cancellations(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_cancellations_order ON public.order_cancellations(order_id);

ALTER TABLE public.order_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_cancellations owner read" ON public.order_cancellations;
CREATE POLICY "order_cancellations owner read"
  ON public.order_cancellations
  FOR SELECT
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = order_cancellations.organization_id
        AND (o.owner_id = auth.uid() OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );
-- INSERT só via SECURITY DEFINER (sem policy de insert pública)

-- 3) Atualiza cancelar_pedido para validar status, exigir motivo após preparo e logar
DROP FUNCTION IF EXISTS public.cancelar_pedido(uuid);

CREATE OR REPLACE FUNCTION public.cancelar_pedido(_order_id uuid, _motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_is_owner boolean := false;
  v_age_seconds numeric;
  v_kind text;
  v_reembolso text := 'none';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  v_is_owner := public.user_owns_org(v_order.organization_id, v_uid);

  -- cliente comum só cancela se o pedido for dele E ainda estiver pending
  IF NOT v_is_owner THEN
    IF v_order.user_id IS NULL OR v_order.user_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    IF v_order.status <> 'pending' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'status_locked');
    END IF;
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already_cancelled', true);
  END IF;

  IF v_order.status = 'delivered' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_delivered');
  END IF;

  -- A partir de preparo, motivo é obrigatório e apenas owner pode cancelar
  IF v_order.status IN ('preparing', 'out_for_delivery') THEN
    IF NOT v_is_owner THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'admin_only');
    END IF;
    IF _motivo IS NULL OR length(btrim(_motivo)) < 3 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'reason_required');
    END IF;
  END IF;

  v_age_seconds := EXTRACT(EPOCH FROM (now() - v_order.created_at));

  -- Regra de reembolso
  IF v_order.status = 'pending' OR v_age_seconds <= 300 THEN
    v_reembolso := 'auto_eligible';
  ELSE
    v_reembolso := 'manual_required';
  END IF;

  -- Atualiza pedido
  UPDATE public.orders
    SET status = 'cancelled',
        status_reembolso = v_reembolso,
        updated_at = now()
    WHERE id = _order_id;

  -- Devolve estoque
  PERFORM public.restock_from_items(v_order.organization_id, v_order.items);

  -- Log
  v_kind := CASE WHEN v_is_owner THEN 'owner' ELSE 'customer' END;
  INSERT INTO public.order_cancellations
    (order_id, organization_id, cancelled_by, cancelled_by_kind, previous_status, reason)
  VALUES
    (_order_id, v_order.organization_id, v_uid, v_kind, v_order.status, COALESCE(_motivo, ''));

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', _order_id,
    'previous_status', v_order.status,
    'status_reembolso', v_reembolso
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_pedido(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido(uuid, text) TO authenticated;

-- 4) Auto-cancelamento (TTL 5min): registra log como sistema e marca reembolso auto
CREATE OR REPLACE FUNCTION public.auto_cancel_stale_pending_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.orders%ROWTYPE;
  cnt integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.orders
      WHERE status = 'pending'
        AND created_at < (now() - interval '5 minutes')
      FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.orders
      SET status = 'cancelled',
          status_reembolso = 'auto_eligible',
          updated_at = now()
      WHERE id = r.id;

    PERFORM public.restock_from_items(r.organization_id, r.items);

    INSERT INTO public.order_cancellations
      (order_id, organization_id, cancelled_by, cancelled_by_kind, previous_status, reason)
    VALUES
      (r.id, r.organization_id, NULL, 'system', r.status, 'TTL expirado (5 min sem pagamento)');

    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_cancel_stale_pending_orders() FROM PUBLIC, anon, authenticated;