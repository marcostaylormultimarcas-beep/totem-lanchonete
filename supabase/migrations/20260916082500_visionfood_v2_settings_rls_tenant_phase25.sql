DROP POLICY IF EXISTS settings_authenticated_read ON public.settings;
DROP POLICY IF EXISTS settings_public_read ON public.settings;
DROP POLICY IF EXISTS settings_owner_delete ON public.settings;
DROP POLICY IF EXISTS settings_owner_insert ON public.settings;
DROP POLICY IF EXISTS settings_owner_update ON public.settings;

CREATE POLICY settings_public_read ON public.settings
FOR SELECT TO anon USING (organization_id IS NOT NULL);

CREATE POLICY settings_tenant_select ON public.settings
FOR SELECT TO authenticated
USING (public.usuario_dono_org(organization_id, (select auth.uid())));

CREATE POLICY settings_tenant_insert ON public.settings
FOR INSERT TO authenticated
WITH CHECK (public.usuario_dono_org(organization_id, (select auth.uid())));

CREATE POLICY settings_tenant_update ON public.settings
FOR UPDATE TO authenticated
USING (public.usuario_dono_org(organization_id, (select auth.uid())))
WITH CHECK (public.usuario_dono_org(organization_id, (select auth.uid())));

CREATE POLICY settings_tenant_delete ON public.settings
FOR DELETE TO authenticated
USING (public.usuario_dono_org(organization_id, (select auth.uid())));
