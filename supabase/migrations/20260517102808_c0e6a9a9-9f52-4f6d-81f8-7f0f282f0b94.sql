
-- 1. Roles
CREATE TYPE public.app_role AS ENUM ('master', 'admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'master'));
CREATE POLICY "Master manages roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'master'))
  WITH CHECK (public.has_role(auth.uid(), 'master'));

-- 2. owner_id em organizations (1:1 com auth.users para contas novas)
ALTER TABLE public.organizations ADD COLUMN owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX organizations_owner_id_key ON public.organizations(owner_id) WHERE owner_id IS NOT NULL;

-- 3. RLS organizations
DROP POLICY IF EXISTS "Anyone can view organizations" ON public.organizations;
DROP POLICY IF EXISTS "Anyone can insert organizations" ON public.organizations;
DROP POLICY IF EXISTS "Anyone can update organizations" ON public.organizations;
DROP POLICY IF EXISTS "Anyone can delete organizations" ON public.organizations;

CREATE POLICY "Public can read active orgs by slug" ON public.organizations
  FOR SELECT USING (true);
CREATE POLICY "Owner manages own org" ON public.organizations
  FOR UPDATE USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'master'))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(), 'master'));
CREATE POLICY "Master inserts orgs" ON public.organizations
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'master') OR owner_id = auth.uid());
CREATE POLICY "Master deletes orgs" ON public.organizations
  FOR DELETE USING (public.has_role(auth.uid(), 'master'));

-- 4. RLS products
DROP POLICY IF EXISTS "Anyone can view products" ON public.products;
DROP POLICY IF EXISTS "Anyone can insert products" ON public.products;
DROP POLICY IF EXISTS "Anyone can update products" ON public.products;
DROP POLICY IF EXISTS "Anyone can delete products" ON public.products;

CREATE POLICY "Public read products" ON public.products
  FOR SELECT USING (true);
CREATE POLICY "Owner inserts products" ON public.products
  FOR INSERT WITH CHECK (
    public.has_role(auth.uid(), 'master') OR
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = products.organization_id AND o.owner_id = auth.uid())
  );
CREATE POLICY "Owner updates products" ON public.products
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'master') OR
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = products.organization_id AND o.owner_id = auth.uid())
  );
CREATE POLICY "Owner deletes products" ON public.products
  FOR DELETE USING (
    public.has_role(auth.uid(), 'master') OR
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = products.organization_id AND o.owner_id = auth.uid())
  );

-- 5. RLS settings
DROP POLICY IF EXISTS "Anyone can view settings" ON public.settings;
DROP POLICY IF EXISTS "Anyone can insert settings" ON public.settings;
DROP POLICY IF EXISTS "Anyone can update settings" ON public.settings;

CREATE POLICY "Public read settings" ON public.settings
  FOR SELECT USING (true);
CREATE POLICY "Owner inserts settings" ON public.settings
  FOR INSERT WITH CHECK (
    public.has_role(auth.uid(), 'master') OR
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = settings.organization_id AND o.owner_id = auth.uid())
  );
CREATE POLICY "Owner updates settings" ON public.settings
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'master') OR
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = settings.organization_id AND o.owner_id = auth.uid())
  );

-- 6. RLS orders (cliente final cria sem login; dono lê os da sua loja)
DROP POLICY IF EXISTS "Anyone can view orders" ON public.orders;
DROP POLICY IF EXISTS "Anyone can update orders" ON public.orders;
DROP POLICY IF EXISTS "Anyone can create orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view their own orders" ON public.orders;

CREATE POLICY "Public can create orders" ON public.orders
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Owner reads org orders" ON public.orders
  FOR SELECT USING (
    public.has_role(auth.uid(), 'master') OR
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = orders.organization_id AND o.owner_id = auth.uid())
  );
CREATE POLICY "Owner updates org orders" ON public.orders
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'master') OR
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = orders.organization_id AND o.owner_id = auth.uid())
  );
-- Allow customers tracking their order without login (by id is enforced via app filters)
CREATE POLICY "Public read by order_number" ON public.orders
  FOR SELECT USING (true);

-- 7. Trigger: ao criar usuário no auth, cria organização + settings + role admin
CREATE OR REPLACE FUNCTION public.handle_new_user_org()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  base_slug text;
  final_slug text;
  counter int := 0;
BEGIN
  -- Slug a partir do email (parte antes do @), saneado
  base_slug := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]+', '-', 'g'));
  IF base_slug = '' OR base_slug IS NULL THEN
    base_slug := 'loja-' || substring(NEW.id::text from 1 for 8);
  END IF;
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;

  INSERT INTO public.organizations (name, slug, owner_id)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'display_name', 'Minha Loja'), final_slug, NEW.id)
  RETURNING id INTO new_org_id;

  INSERT INTO public.settings (organization_id, store_name, whatsapp_number, instagram_url)
  VALUES (new_org_id, COALESCE(NEW.raw_user_meta_data->>'display_name', 'Minha Loja'), '', '');

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_org ON auth.users;
CREATE TRIGGER on_auth_user_created_org
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_org();

-- 8. Tabela admins legada — restringir: só Master pode ver/mexer
DROP POLICY IF EXISTS "Anyone can view admins" ON public.admins;
DROP POLICY IF EXISTS "Anyone can insert admins" ON public.admins;
DROP POLICY IF EXISTS "Anyone can update admins" ON public.admins;
DROP POLICY IF EXISTS "Anyone can delete admins" ON public.admins;

CREATE POLICY "Master only on admins" ON public.admins
  FOR ALL USING (public.has_role(auth.uid(), 'master'))
  WITH CHECK (public.has_role(auth.uid(), 'master'));
