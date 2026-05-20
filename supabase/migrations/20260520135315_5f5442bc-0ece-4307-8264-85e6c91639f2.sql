-- 1) Extensão de agendamento
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2) Helper: devolve estoque a partir de um array de items (JSONB)
CREATE OR REPLACE FUNCTION public.restock_from_items(_org uuid, _items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  pid uuid;
  qty integer;
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RETURN;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    BEGIN
      pid := COALESCE(
        NULLIF(item->>'product_id','')::uuid,
        NULLIF(item->>'id','')::uuid
      );
    EXCEPTION WHEN others THEN
      pid := NULL;
    END;

    qty := COALESCE((item->>'quantity')::int, 1);

    IF pid IS NOT NULL AND qty > 0 THEN
      UPDATE public.products
        SET stock_quantity = stock_quantity + qty,
            updated_at = now()
        WHERE id = pid
          AND manage_stock = true
          AND organization_id = _org;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.restock_from_items(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 3) Cancelamento manual com checagem de RLS e devolução atômica de estoque
CREATE OR REPLACE FUNCTION public.cancelar_pedido(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF NOT public.user_owns_org(v_order.organization_id, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already_cancelled', true);
  END IF;

  -- Atômico: status + restock acontecem na mesma transação
  UPDATE public.orders
    SET status = 'cancelled', updated_at = now()
    WHERE id = _order_id;

  PERFORM public.restock_from_items(v_order.organization_id, v_order.items);

  RETURN jsonb_build_object('ok', true, 'order_id', _order_id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancelar_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido(uuid) TO authenticated;

-- 4) Cancelamento automático de pedidos pendentes com mais de 5 minutos (TTL)
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
      SET status = 'cancelled', updated_at = now()
      WHERE id = r.id;
    PERFORM public.restock_from_items(r.organization_id, r.items);
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_cancel_stale_pending_orders() FROM PUBLIC, anon, authenticated;

-- 5) Agenda: executa a cada minuto. Remove agendamento antigo se existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-cancel-stale-pending-orders') THEN
    PERFORM cron.unschedule('auto-cancel-stale-pending-orders');
  END IF;
  PERFORM cron.schedule(
    'auto-cancel-stale-pending-orders',
    '* * * * *',
    $cron$ SELECT public.auto_cancel_stale_pending_orders(); $cron$
  );
END $$;