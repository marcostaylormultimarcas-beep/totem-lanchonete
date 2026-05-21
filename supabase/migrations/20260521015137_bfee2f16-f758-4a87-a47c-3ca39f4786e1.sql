-- ============================================================
-- DELIVERY MANAGEMENT MODULE
-- ============================================================

-- 1) ENTREGADORES TABLE (own auth, plaintext password like admins table)
CREATE TABLE IF NOT EXISTS public.entregadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  username text NOT NULL,
  password text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, username)
);

ALTER TABLE public.entregadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entregadores owner manage"
  ON public.entregadores FOR ALL
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = entregadores.organization_id
        AND (o.owner_id = auth.uid() OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = entregadores.organization_id
        AND (o.owner_id = auth.uid() OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

CREATE TRIGGER trg_entregadores_updated
  BEFORE UPDATE ON public.entregadores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) ADD COLUMNS TO ORDERS
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS entregador_id uuid;

CREATE INDEX IF NOT EXISTS idx_orders_entregador ON public.orders(entregador_id) WHERE entregador_id IS NOT NULL;

-- 3) ENTREGAS LOG (audit trail)
CREATE TABLE IF NOT EXISTS public.entregas_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  entregador_id uuid NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.entregas_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entregas_log owner read"
  ON public.entregas_log FOR SELECT
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = entregas_log.organization_id
        AND (o.owner_id = auth.uid() OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

CREATE INDEX IF NOT EXISTS idx_entregas_log_org ON public.entregas_log(organization_id, delivered_at DESC);

-- 4) AUTO-GENERATE delivery_code on insert
CREATE OR REPLACE FUNCTION public.set_delivery_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_tries int := 0;
BEGIN
  IF NEW.order_type = 'delivery' AND COALESCE(NEW.delivery_code,'') = '' THEN
    LOOP
      v_code := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.orders
        WHERE organization_id = NEW.organization_id
          AND delivery_code = v_code
          AND status IN ('pending','preparing','out_for_delivery')
      ) OR v_tries > 12;
      v_tries := v_tries + 1;
    END LOOP;
    NEW.delivery_code := v_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_delivery_code ON public.orders;
CREATE TRIGGER trg_orders_delivery_code
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_delivery_code();

-- 5) RPC: entregador login (returns minimal session payload)
CREATE OR REPLACE FUNCTION public.entregador_login(_org_slug text, _username text, _password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_e public.entregadores%ROWTYPE;
BEGIN
  SELECT * INTO v_org FROM public.organizations WHERE slug = _org_slug LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'org_not_found');
  END IF;
  SELECT * INTO v_e FROM public.entregadores
    WHERE organization_id = v_org.id
      AND username = _username
      AND password = _password
      AND active = true
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'entregador', jsonb_build_object(
      'id', v_e.id,
      'name', v_e.name,
      'username', v_e.username,
      'organization_id', v_e.organization_id,
      'org_slug', v_org.slug,
      'org_name', v_org.name
    )
  );
END;
$$;

-- 6) RPC: list orders assigned to entregador (auth via password)
CREATE OR REPLACE FUNCTION public.entregador_orders(_entregador_id uuid, _password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.entregadores%ROWTYPE;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_e FROM public.entregadores
    WHERE id = _entregador_id AND password = _password AND active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(o.*) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM public.orders o
  WHERE o.organization_id = v_e.organization_id
    AND o.entregador_id = v_e.id
    AND o.status IN ('preparing','out_for_delivery','ready','delivered')
    AND o.created_at > now() - interval '7 days';

  RETURN jsonb_build_object('ok', true, 'orders', v_rows);
END;
$$;

-- 7) RPC: admin assigns entregador to an order
CREATE OR REPLACE FUNCTION public.assign_entregador(_order_id uuid, _entregador_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_e public.entregadores%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  IF NOT public.user_owns_org(v_order.organization_id, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _entregador_id IS NOT NULL THEN
    SELECT * INTO v_e FROM public.entregadores WHERE id = _entregador_id;
    IF NOT FOUND OR v_e.organization_id <> v_order.organization_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'entregador_invalid');
    END IF;
  END IF;
  UPDATE public.orders SET entregador_id = _entregador_id, updated_at = now() WHERE id = _order_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 8) RPC: entregador confirms delivery with security code
CREATE OR REPLACE FUNCTION public.confirm_delivery_with_code(
  _entregador_id uuid,
  _password text,
  _order_id uuid,
  _code text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.entregadores%ROWTYPE;
  v_order public.orders%ROWTYPE;
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

  IF v_order.entregador_id IS DISTINCT FROM v_e.id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_assigned');
  END IF;

  IF v_order.status = 'delivered' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_delivered');
  END IF;
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cancelled');
  END IF;

  IF COALESCE(v_order.delivery_code,'') = '' OR v_order.delivery_code <> _code THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  UPDATE public.orders SET status = 'delivered', updated_at = now() WHERE id = _order_id;

  INSERT INTO public.entregas_log (order_id, organization_id, entregador_id, delivered_at)
    VALUES (_order_id, v_order.organization_id, v_e.id, now());

  RETURN jsonb_build_object('ok', true);
END;
$$;
