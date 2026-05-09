CREATE TABLE public.admins (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  is_master BOOLEAN NOT NULL DEFAULT false,
  paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view admins" ON public.admins FOR SELECT USING (true);
CREATE POLICY "Anyone can insert admins" ON public.admins FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update admins" ON public.admins FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete admins" ON public.admins FOR DELETE USING (true);

CREATE TRIGGER update_admins_updated_at
BEFORE UPDATE ON public.admins
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.admins (username, password, is_master) VALUES ('master', '1234', true);