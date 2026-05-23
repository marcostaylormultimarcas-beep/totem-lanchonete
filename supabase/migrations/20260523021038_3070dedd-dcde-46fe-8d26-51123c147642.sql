
-- INGREDIENTES
CREATE TABLE IF NOT EXISTS public.ingredientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  nome text NOT NULL,
  unidade text NOT NULL DEFAULT 'un',
  estoque_atual numeric NOT NULL DEFAULT 0,
  estoque_minimo numeric NOT NULL DEFAULT 0,
  disponivel boolean NOT NULL DEFAULT true,
  last_alert_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingredientes_org ON public.ingredientes(organization_id);

ALTER TABLE public.ingredientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingredientes public read" ON public.ingredientes FOR SELECT USING (true);
CREATE POLICY "ingredientes owner manage" ON public.ingredientes FOR ALL
  USING (is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = ingredientes.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))))
  WITH CHECK (is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = ingredientes.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))));

CREATE TRIGGER trg_ingredientes_updated_at BEFORE UPDATE ON public.ingredientes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RECEITAS
CREATE TABLE IF NOT EXISTS public.receitas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  product_id uuid NOT NULL,
  ingrediente_id uuid NOT NULL,
  quantidade numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, ingrediente_id)
);
CREATE INDEX IF NOT EXISTS idx_receitas_product ON public.receitas(product_id);
CREATE INDEX IF NOT EXISTS idx_receitas_ingrediente ON public.receitas(ingrediente_id);

ALTER TABLE public.receitas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receitas public read" ON public.receitas FOR SELECT USING (true);
CREATE POLICY "receitas owner manage" ON public.receitas FOR ALL
  USING (is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = receitas.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))))
  WITH CHECK (is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = receitas.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))));

CREATE TRIGGER trg_receitas_updated_at BEFORE UPDATE ON public.receitas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ALERTAS DE ESTOQUE
CREATE TABLE IF NOT EXISTS public.alertas_estoque (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  ingrediente_id uuid,
  product_id uuid,
  tipo text NOT NULL DEFAULT 'ruptura', -- ruptura | minimo | bloqueio
  mensagem text NOT NULL DEFAULT '',
  webhook_status text NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped
  webhook_error text NOT NULL DEFAULT '',
  resolvido boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alertas_estoque_org ON public.alertas_estoque(organization_id, created_at DESC);

ALTER TABLE public.alertas_estoque ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alertas_estoque owner read" ON public.alertas_estoque FOR SELECT
  USING (is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = alertas_estoque.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))));
CREATE POLICY "alertas_estoque owner update" ON public.alertas_estoque FOR UPDATE
  USING (is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = alertas_estoque.organization_id
      AND (o.owner_id = auth.uid() OR (is_master_admin(auth.uid()) AND o.master_id = auth.uid()))));

-- Coluna available em products (bloqueio dinâmico por ingrediente)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS available boolean NOT NULL DEFAULT true;

-- Webhook de alerta na configuração da loja (reutiliza configuracoes_impressao.webhook_alerta_url se preferir)
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS estoque_webhook_url text NOT NULL DEFAULT '';

-- FUNÇÃO: consumir receita ao criar pedido
CREATE OR REPLACE FUNCTION public.consumir_estoque_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  pid uuid;
  qty numeric;
  r record;
  novo_estoque numeric;
  v_prod_name text;
BEGIN
  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    BEGIN
      pid := COALESCE(NULLIF(item->>'product_id','')::uuid, NULLIF(item->>'id','')::uuid);
    EXCEPTION WHEN others THEN pid := NULL; END;
    qty := COALESCE((item->>'quantity')::numeric, 1);
    IF pid IS NULL OR qty <= 0 THEN CONTINUE; END IF;

    FOR r IN
      SELECT rec.ingrediente_id, rec.quantidade, ing.nome, ing.estoque_atual
        FROM public.receitas rec
        JOIN public.ingredientes ing ON ing.id = rec.ingrediente_id
       WHERE rec.product_id = pid AND rec.organization_id = NEW.organization_id
       FOR UPDATE OF ing
    LOOP
      novo_estoque := r.estoque_atual - (r.quantidade * qty);
      UPDATE public.ingredientes
         SET estoque_atual = novo_estoque,
             disponivel = (novo_estoque > 0),
             updated_at = now()
       WHERE id = r.ingrediente_id;

      IF novo_estoque <= 0 THEN
        -- Bloqueia todos os produtos que usam esse ingrediente
        UPDATE public.products p
           SET available = false, updated_at = now()
         WHERE p.organization_id = NEW.organization_id
           AND p.id IN (SELECT product_id FROM public.receitas WHERE ingrediente_id = r.ingrediente_id);

        SELECT name INTO v_prod_name FROM public.products WHERE id = pid;
        INSERT INTO public.alertas_estoque (organization_id, ingrediente_id, product_id, tipo, mensagem)
          VALUES (NEW.organization_id, r.ingrediente_id, pid, 'ruptura',
            'Ingrediente "' || r.nome || '" esgotado. Produtos relacionados foram desativados automaticamente.');

        UPDATE public.ingredientes SET last_alert_at = now() WHERE id = r.ingrediente_id;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consumir_estoque_from_order ON public.orders;
CREATE TRIGGER trg_consumir_estoque_from_order
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.consumir_estoque_from_order();

-- FUNÇÃO: reativar produto manualmente após repor estoque
CREATE OR REPLACE FUNCTION public.reabastecer_ingrediente(_id uuid, _quantidade numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.ingredientes WHERE id = _id;
  IF v_org IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT user_owns_org(v_org, auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  UPDATE public.ingredientes
     SET estoque_atual = estoque_atual + _quantidade,
         disponivel = (estoque_atual + _quantidade) > 0,
         updated_at = now()
   WHERE id = _id;

  -- Reativa produtos cujo TODOS os ingredientes estejam disponíveis
  UPDATE public.products p SET available = true, updated_at = now()
   WHERE p.organization_id = v_org
     AND p.id IN (
       SELECT product_id FROM public.receitas WHERE ingrediente_id = _id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.receitas r2
       JOIN public.ingredientes i2 ON i2.id = r2.ingrediente_id
       WHERE r2.product_id = p.id AND i2.estoque_atual <= 0
     );

  UPDATE public.alertas_estoque SET resolvido = true
   WHERE ingrediente_id = _id AND resolvido = false;

  RETURN jsonb_build_object('ok', true);
END;
$$;
