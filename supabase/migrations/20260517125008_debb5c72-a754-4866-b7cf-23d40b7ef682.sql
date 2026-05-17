-- 1. Add master_id to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS master_id uuid;

CREATE INDEX IF NOT EXISTS idx_organizations_master_id ON public.organizations(master_id);

-- 2. Migrate legacy 'master' role -> 'super_admin'
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'super_admin'::app_role FROM public.user_roles WHERE role = 'master'
ON CONFLICT DO NOTHING;

-- 3. Helper functions
CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('super_admin','master')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_master_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role = 'master_admin'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_master_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master_admin(uuid) TO authenticated;

-- 4. Update organizations policies
DROP POLICY IF EXISTS "Owner manages own org" ON public.organizations;
DROP POLICY IF EXISTS "Master inserts orgs" ON public.organizations;
DROP POLICY IF EXISTS "Master deletes orgs" ON public.organizations;

CREATE POLICY "Org insert (super/master/self)" ON public.organizations
FOR INSERT WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (public.is_master_admin(auth.uid()) AND master_id = auth.uid())
  OR owner_id = auth.uid()
);

CREATE POLICY "Org update (super/master/owner)" ON public.organizations
FOR UPDATE USING (
  public.is_super_admin(auth.uid())
  OR (public.is_master_admin(auth.uid()) AND master_id = auth.uid())
  OR owner_id = auth.uid()
) WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (public.is_master_admin(auth.uid()) AND master_id = auth.uid())
  OR owner_id = auth.uid()
);

CREATE POLICY "Org delete (super/master)" ON public.organizations
FOR DELETE USING (
  public.is_super_admin(auth.uid())
  OR (public.is_master_admin(auth.uid()) AND master_id = auth.uid())
);

-- 5. Update user_roles policies (allow master to see admins they created)
DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Master manages roles" ON public.user_roles;

CREATE POLICY "user_roles select" ON public.user_roles
FOR SELECT USING (
  user_id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR public.is_master_admin(auth.uid())
);

CREATE POLICY "user_roles super manage" ON public.user_roles
FOR ALL USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "user_roles master assigns admin" ON public.user_roles
FOR INSERT WITH CHECK (
  public.is_master_admin(auth.uid()) AND role = 'admin'
);

CREATE POLICY "user_roles master deletes admin" ON public.user_roles
FOR DELETE USING (
  public.is_master_admin(auth.uid()) AND role = 'admin'
);

-- 6. Extend resource policies (products/cupons/settings/orders) to include master_admin scope
-- products
DROP POLICY IF EXISTS "Owner inserts products" ON public.products;
DROP POLICY IF EXISTS "Owner updates products" ON public.products;
DROP POLICY IF EXISTS "Owner deletes products" ON public.products;

CREATE POLICY "products manage" ON public.products
FOR ALL USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = products.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
) WITH CHECK (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = products.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

-- cupons
DROP POLICY IF EXISTS "Owner inserts cupons" ON public.cupons;
DROP POLICY IF EXISTS "Owner updates cupons" ON public.cupons;
DROP POLICY IF EXISTS "Owner deletes cupons" ON public.cupons;

CREATE POLICY "cupons manage" ON public.cupons
FOR ALL USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = cupons.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
) WITH CHECK (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = cupons.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

-- settings
DROP POLICY IF EXISTS "Owner inserts settings" ON public.settings;
DROP POLICY IF EXISTS "Owner updates settings" ON public.settings;

CREATE POLICY "settings insert" ON public.settings
FOR INSERT WITH CHECK (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = settings.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

CREATE POLICY "settings update" ON public.settings
FOR UPDATE USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = settings.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

-- orders
DROP POLICY IF EXISTS "Owner reads org orders" ON public.orders;
DROP POLICY IF EXISTS "Owner updates org orders" ON public.orders;

CREATE POLICY "orders select" ON public.orders
FOR SELECT USING (
  public.is_super_admin(auth.uid())
  OR user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = orders.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

CREATE POLICY "orders update" ON public.orders
FOR UPDATE USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = orders.organization_id
      AND (o.owner_id = auth.uid()
           OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
  )
);

-- admins (legacy table)
DROP POLICY IF EXISTS "Master only on admins" ON public.admins;
CREATE POLICY "admins super only" ON public.admins
FOR ALL USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));