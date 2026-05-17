
CREATE OR REPLACE FUNCTION public.handle_new_user_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id uuid;
  base_slug text;
  final_slug text;
  counter int := 0;
  is_admin_signup boolean;
BEGIN
  is_admin_signup := COALESCE(NEW.raw_user_meta_data->>'account_type', '') = 'admin';

  -- Clientes (não-ADM) não criam loja
  IF NOT is_admin_signup THEN
    RETURN NEW;
  END IF;

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

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Garante que o trigger esteja presente
DROP TRIGGER IF EXISTS on_auth_user_created_org ON auth.users;
CREATE TRIGGER on_auth_user_created_org
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_org();
