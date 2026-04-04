
-- Create products table
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'hamburgueres',
  image TEXT NOT NULL DEFAULT '🍔',
  removable_ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  extras JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_combo BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Anyone can insert products" ON public.products FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update products" ON public.products FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete products" ON public.products FOR DELETE USING (true);

-- Create settings table (single-row config)
CREATE TABLE public.settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_name TEXT NOT NULL DEFAULT 'Vision Mídia',
  whatsapp_number TEXT NOT NULL DEFAULT '',
  cover_image TEXT DEFAULT '',
  combo JSONB NOT NULL DEFAULT '{"name":"Batata + Refri","description":"Batata + Refri","price":15,"emoji":"🍟🥤"}'::jsonb,
  banners JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view settings" ON public.settings FOR SELECT USING (true);
CREATE POLICY "Anyone can insert settings" ON public.settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update settings" ON public.settings FOR UPDATE USING (true);

-- Add update triggers
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default products
INSERT INTO public.products (name, price, category, image, removable_ingredients, extras) VALUES
  ('X-Burguer Clássico', 25.90, 'hamburgueres', '🍔', '["Cebola","Alface","Tomate","Picles"]', '[{"name":"Bacon","price":5},{"name":"Queijo Extra","price":4},{"name":"Ovo","price":3}]'),
  ('X-Bacon Duplo', 32.90, 'hamburgueres', '🍔', '["Cebola","Alface","Tomate"]', '[{"name":"Bacon Extra","price":5},{"name":"Cheddar","price":4}]'),
  ('Smash Burger', 28.90, 'hamburgueres', '🍔', '["Cebola Caramelizada","Picles"]', '[{"name":"Blend Extra","price":8},{"name":"Queijo Extra","price":4}]'),
  ('Pizza Calabresa', 39.90, 'pizzas', '🍕', '["Cebola","Azeitona"]', '[{"name":"Borda Recheada","price":8},{"name":"Catupiry","price":6}]'),
  ('Pizza Margherita', 35.90, 'pizzas', '🍕', '["Manjericão","Tomate"]', '[{"name":"Borda Recheada","price":8}]'),
  ('Pizza Frango c/ Catupiry', 42.90, 'pizzas', '🍕', '["Milho","Catupiry"]', '[{"name":"Borda Recheada","price":8},{"name":"Bacon","price":5}]'),
  ('Coca-Cola 350ml', 6.90, 'bebidas', '🥤', '[]', '[]'),
  ('Suco Natural', 9.90, 'bebidas', '🧃', '[]', '[{"name":"Sem Açúcar","price":0}]'),
  ('Água Mineral', 4.90, 'bebidas', '💧', '[]', '[]');

-- Seed default settings
INSERT INTO public.settings (store_name, whatsapp_number, banners) VALUES
  ('Vision Mídia', '5562994995768', '[{"id":"1","title":"Combo do Dia","subtitle":"Hambúrguer + Batata + Refri por R$29,90","image":"🍔🍟🥤","badgeText":"🔥 PROMO","badgeColor":"secondary"},{"id":"2","title":"Frete Grátis","subtitle":"Pedidos acima de R$50 não pagam entrega!","image":"🛵💨","badgeText":"✨ GRÁTIS","badgeColor":"accent"},{"id":"3","title":"Pizza em Dobro","subtitle":"Às terças, leve 2 e pague 1!","image":"🍕🍕","badgeText":"🎉 2x1","badgeColor":"primary"}]');
