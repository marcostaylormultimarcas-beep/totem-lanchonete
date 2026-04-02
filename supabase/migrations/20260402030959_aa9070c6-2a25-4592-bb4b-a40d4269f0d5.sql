
-- Create orders table
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  order_type TEXT NOT NULL DEFAULT 'local',
  delivery_address TEXT DEFAULT '',
  delivery_reference TEXT DEFAULT '',
  delivery_recipient TEXT DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Everyone can read orders
CREATE POLICY "Anyone can view orders" ON public.orders FOR SELECT USING (true);

-- Everyone can create orders (anon customers)
CREATE POLICY "Anyone can create orders" ON public.orders FOR INSERT WITH CHECK (true);

-- Everyone can update orders (admin uses password-based auth client-side)
CREATE POLICY "Anyone can update orders" ON public.orders FOR UPDATE USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create produtos storage bucket (public)
INSERT INTO storage.buckets (id, name, public) VALUES ('produtos', 'produtos', true);

-- Anyone can view product images
CREATE POLICY "Product images are public" ON storage.objects FOR SELECT USING (bucket_id = 'produtos');

-- Anyone can upload product images (admin panel)
CREATE POLICY "Anyone can upload product images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'produtos');

-- Anyone can update product images
CREATE POLICY "Anyone can update product images" ON storage.objects FOR UPDATE USING (bucket_id = 'produtos');

-- Anyone can delete product images
CREATE POLICY "Anyone can delete product images" ON storage.objects FOR DELETE USING (bucket_id = 'produtos');
