-- Add a feature key for the Smart Stock module so it can be gated per plan
INSERT INTO public.features (key, name, description, category, sort_order)
VALUES ('estoque_inteligente', 'Estoque Inteligente', 'Controle de estoque por ingrediente e alertas de ruptura', 'operacao', 50)
ON CONFLICT (key) DO NOTHING;

-- Enable the new feature for every existing plan by default so we don't accidentally
-- lock stores that already use it. Super Master can later restrict in the Plans matrix.
INSERT INTO public.plan_features (plan_id, feature_id, enabled)
SELECT p.id, f.id, true
FROM public.plans p
CROSS JOIN public.features f
WHERE f.key = 'estoque_inteligente'
ON CONFLICT DO NOTHING;