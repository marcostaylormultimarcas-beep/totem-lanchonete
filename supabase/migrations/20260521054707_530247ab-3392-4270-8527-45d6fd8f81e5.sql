
-- 1) Feature catalog entry
INSERT INTO public.features (key, name, description, category, sort_order)
VALUES ('vision_assistant', 'Assistente Vision (IA)', 'Consultor de marketing inteligente com sugestões de ação', 'ia', 100)
ON CONFLICT (key) DO NOTHING;

-- 2) Enable on premium plan by default
INSERT INTO public.plan_features (plan_id, feature_id, enabled)
SELECT p.id, f.id, true
FROM public.plans p, public.features f
WHERE p.key = 'premium' AND f.key = 'vision_assistant'
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- 3) Feedback table
CREATE TABLE IF NOT EXISTS public.assistente_vision_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  suggestion_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('approved','dismissed','sent')),
  reason text NOT NULL DEFAULT '',
  message_sent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avf_org_key ON public.assistente_vision_feedback(organization_id, suggestion_key);

ALTER TABLE public.assistente_vision_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "avf owner manage"
ON public.assistente_vision_feedback
FOR ALL
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = assistente_vision_feedback.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = assistente_vision_feedback.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);
