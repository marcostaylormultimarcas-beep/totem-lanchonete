-- 1) Colunas de estoque
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS manage_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 5;

-- 2) Função que decrementa estoque a partir dos items (JSONB) de um pedido
CREATE OR REPLACE FUNCTION public.decrement_stock_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  pid uuid;
  qty integer;
BEGIN
  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(NEW.items)
  LOOP
    -- aceita item.id ou item.product_id
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
        SET stock_quantity = GREATEST(stock_quantity - qty, 0),
            updated_at = now()
        WHERE id = pid
          AND manage_stock = true
          AND organization_id = NEW.organization_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- 3) Trigger no INSERT de orders
DROP TRIGGER IF EXISTS trg_decrement_stock_on_order ON public.orders;
CREATE TRIGGER trg_decrement_stock_on_order
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.decrement_stock_from_order();