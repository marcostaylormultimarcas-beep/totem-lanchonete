-- 1) Coluna de modo de atribuição
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS delivery_assignment_mode text NOT NULL DEFAULT 'manual';

-- check valid values via trigger (avoid check constraint rigidity)
CREATE OR REPLACE FUNCTION public.validate_delivery_assignment_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.delivery_assignment_mode NOT IN ('manual','free') THEN
    RAISE EXCEPTION 'delivery_assignment_mode invalid: %', NEW.delivery_assignment_mode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_delivery_assignment_mode ON public.settings;
CREATE TRIGGER trg_validate_delivery_assignment_mode
BEFORE INSERT OR UPDATE ON public.settings
FOR EACH ROW EXECUTE FUNCTION public.validate_delivery_assignment_mode();

-- 2) Listar pedidos disponíveis para disputa livre
CREATE OR REPLACE FUNCTION public.entregador_available_orders(_entregador_id uuid, _password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.entregadores%ROWTYPE;
  v_mode text;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_e FROM public.entregadores
    WHERE id = _entregador_id AND password = _password AND active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  END IF;

  SELECT COALESCE(delivery_assignment_mode,'manual') INTO v_mode
    FROM public.settings WHERE organization_id = v_e.organization_id LIMIT 1;

  IF v_mode <> 'free' THEN
    RETURN jsonb_build_object('ok', true, 'mode', v_mode, 'orders', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(o.*) ORDER BY o.created_at ASC), '[]'::jsonb)
    INTO v_rows
  FROM public.orders o
  WHERE o.organization_id = v_e.organization_id
    AND o.order_type IN ('delivery','viagem')
    AND o.entregador_id IS NULL
    AND o.status IN ('preparing','ready','out_for_delivery')
    AND o.created_at > now() - interval '1 day';

  RETURN jsonb_build_object('ok', true, 'mode', v_mode, 'orders', v_rows);
END;
$$;

-- 3) Reivindicar pedido (claim) — atômico
CREATE OR REPLACE FUNCTION public.entregador_claim_order(_entregador_id uuid, _password text, _order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.entregadores%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_mode text;
  v_updated int;
BEGIN
  SELECT * INTO v_e FROM public.entregadores
    WHERE id = _entregador_id AND password = _password AND active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  IF v_order.organization_id <> v_e.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT COALESCE(delivery_assignment_mode,'manual') INTO v_mode
    FROM public.settings WHERE organization_id = v_e.organization_id LIMIT 1;
  IF v_mode <> 'free' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mode_not_free');
  END IF;

  IF v_order.entregador_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_taken');
  END IF;

  UPDATE public.orders
    SET entregador_id = v_e.id, updated_at = now()
    WHERE id = _order_id AND entregador_id IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_taken');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;