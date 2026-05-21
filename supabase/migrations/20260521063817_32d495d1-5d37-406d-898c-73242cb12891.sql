-- 1) Tabela de histórico de sugestões da IA
CREATE TABLE IF NOT EXISTS public.ai_suggestions_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  suggestion_key text NOT NULL,
  category text NOT NULL DEFAULT 'geral',
  title text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  template text NOT NULL DEFAULT '',
  priority integer NOT NULL DEFAULT 5,
  audience_size integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | dismissed | sent
  dismiss_reason text NOT NULL DEFAULT '',
  notifications_sent integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  acted_at timestamptz,
  dispatched_at timestamptz,
  last_conversion_check timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_hist_org ON public.ai_suggestions_history(organization_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_hist_org_key ON public.ai_suggestions_history(organization_id, suggestion_key);
CREATE INDEX IF NOT EXISTS idx_ai_hist_status ON public.ai_suggestions_history(organization_id, status);

ALTER TABLE public.ai_suggestions_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_hist owner manage"
ON public.ai_suggestions_history
FOR ALL
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = ai_suggestions_history.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = ai_suggestions_history.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

CREATE TRIGGER trg_ai_hist_updated_at
BEFORE UPDATE ON public.ai_suggestions_history
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Estatísticas por categoria para alimentar o ranking
CREATE OR REPLACE FUNCTION public.ai_suggestion_stats(_org uuid)
RETURNS TABLE(
  category text,
  total_sent integer,
  total_dismissed integer,
  total_conversions integer,
  conversion_rate numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    category,
    COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0)::int      AS total_sent,
    COALESCE(SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END), 0)::int  AS total_dismissed,
    COALESCE(SUM(conversions), 0)::int                                       AS total_conversions,
    CASE
      WHEN COALESCE(SUM(notifications_sent), 0) = 0 THEN 0
      ELSE ROUND( (SUM(conversions)::numeric / SUM(notifications_sent)::numeric) * 100, 2)
    END AS conversion_rate
  FROM public.ai_suggestions_history
  WHERE organization_id = _org
  GROUP BY category;
$$;

-- 3) Atribuição de conversões: pedidos feitos pelos telefones notificados em até 7 dias
CREATE OR REPLACE FUNCTION public.ai_attribute_conversions(_org uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_count int;
  v_total int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  IF NOT public.user_owns_org(_org, auth.uid()) THEN RETURN 0; END IF;

  FOR r IN
    SELECT id, dispatched_at
      FROM public.ai_suggestions_history
     WHERE organization_id = _org
       AND status = 'sent'
       AND dispatched_at IS NOT NULL
       AND dispatched_at > now() - interval '30 days'
  LOOP
    SELECT COUNT(DISTINCT o.id) INTO v_count
      FROM public.orders o
      JOIN public.cliente_notificacoes n
        ON n.organization_id = o.organization_id
       AND regexp_replace(COALESCE(n.customer_phone,''),'\D','','g')
         = regexp_replace(COALESCE(o.customer_phone,''),'\D','','g')
     WHERE o.organization_id = _org
       AND o.created_at BETWEEN r.dispatched_at AND r.dispatched_at + interval '7 days'
       AND o.status <> 'cancelled'
       AND n.created_at <= o.created_at
       AND n.created_at >= r.dispatched_at - interval '1 minute'
       AND n.created_at <= r.dispatched_at + interval '1 minute';

    UPDATE public.ai_suggestions_history
       SET conversions = COALESCE(v_count, 0),
           last_conversion_check = now()
     WHERE id = r.id;
    v_total := v_total + COALESCE(v_count, 0);
  END LOOP;

  RETURN v_total;
END;
$$;