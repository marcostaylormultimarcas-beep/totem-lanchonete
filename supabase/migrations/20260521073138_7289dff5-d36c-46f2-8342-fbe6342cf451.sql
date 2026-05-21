
-- =========================================
-- Configurações de impressão por loja
-- =========================================
CREATE TABLE IF NOT EXISTS public.configuracoes_impressao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  auto_print boolean NOT NULL DEFAULT true,
  printer_ip text NOT NULL DEFAULT '',
  printer_port integer NOT NULL DEFAULT 9100,
  paper_width integer NOT NULL DEFAULT 48,
  agent_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS configuracoes_impressao_token_idx
  ON public.configuracoes_impressao(agent_token);

ALTER TABLE public.configuracoes_impressao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "configuracoes_impressao owner manage"
ON public.configuracoes_impressao
FOR ALL
USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = configuracoes_impressao.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
)
WITH CHECK (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = configuracoes_impressao.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

CREATE TRIGGER trg_configuracoes_impressao_updated_at
BEFORE UPDATE ON public.configuracoes_impressao
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- Colunas de rastreio de impressão em orders
-- =========================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS print_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS print_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS print_error text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS orders_print_queue_idx
  ON public.orders(organization_id, print_status, created_at);

-- =========================================
-- Trigger: enfileira pedido para impressão quando entra em produção
-- =========================================
CREATE OR REPLACE FUNCTION public.queue_order_for_printing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('preparing','ready','out_for_delivery','delivered')
     AND COALESCE(NEW.print_status,'pending') = 'pending' THEN
    NEW.print_status := 'queued';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_order_for_printing ON public.orders;
CREATE TRIGGER trg_queue_order_for_printing
BEFORE INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.queue_order_for_printing();

-- =========================================
-- Funções RPC para o agente local (autenticadas por token)
-- =========================================
CREATE OR REPLACE FUNCTION public.print_agent_authenticate(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.configuracoes_impressao%ROWTYPE;
  v_org public.organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM public.configuracoes_impressao WHERE agent_token = _token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;
  IF NOT v_cfg.enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  UPDATE public.configuracoes_impressao
    SET last_seen_at = now(), updated_at = now()
    WHERE id = v_cfg.id;
  SELECT * INTO v_org FROM public.organizations WHERE id = v_cfg.organization_id;
  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', v_cfg.organization_id,
    'org_name', COALESCE(v_org.name, ''),
    'paper_width', v_cfg.paper_width,
    'auto_print', v_cfg.auto_print
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.print_agent_claim_jobs(_token text, _limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.configuracoes_impressao%ROWTYPE;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_cfg FROM public.configuracoes_impressao WHERE agent_token = _token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;
  IF NOT v_cfg.enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  UPDATE public.configuracoes_impressao
    SET last_seen_at = now() WHERE id = v_cfg.id;

  WITH claimed AS (
    SELECT id FROM public.orders
     WHERE organization_id = v_cfg.organization_id
       AND print_status IN ('queued','pendente_impressao')
       AND created_at > now() - interval '2 days'
     ORDER BY created_at ASC
     LIMIT GREATEST(1, LEAST(_limit, 25))
     FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.orders o
       SET print_status = 'printing',
           print_attempts = o.print_attempts + 1,
           updated_at = now()
      FROM claimed
     WHERE o.id = claimed.id
     RETURNING o.*
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(upd.*) ORDER BY upd.created_at ASC), '[]'::jsonb)
    INTO v_rows FROM upd;

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', v_cfg.organization_id,
    'jobs', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.print_agent_ack(_token text, _order_id uuid, _success boolean, _error text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.configuracoes_impressao%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM public.configuracoes_impressao WHERE agent_token = _token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND OR v_order.organization_id <> v_cfg.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF _success THEN
    UPDATE public.orders
       SET print_status = 'printed',
           printed_at = now(),
           print_error = '',
           updated_at = now()
     WHERE id = _order_id;
  ELSE
    UPDATE public.orders
       SET print_status = 'pendente_impressao',
           print_error = LEFT(COALESCE(_error,''), 500),
           updated_at = now()
     WHERE id = _order_id;
  END IF;

  UPDATE public.configuracoes_impressao SET last_seen_at = now() WHERE id = v_cfg.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.print_agent_rotate_token(_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new text;
BEGIN
  IF auth.uid() IS NULL OR NOT user_owns_org(_org, auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  v_new := encode(gen_random_bytes(24), 'hex');
  INSERT INTO public.configuracoes_impressao (organization_id, agent_token)
  VALUES (_org, v_new)
  ON CONFLICT (organization_id) DO UPDATE
    SET agent_token = EXCLUDED.agent_token, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'token', v_new);
END;
$$;
