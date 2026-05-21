CREATE TABLE public.cliente_notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  customer_phone text NOT NULL,
  suggestion_key text NOT NULL DEFAULT '',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  cta_route text NOT NULL DEFAULT '',
  coupon_code text NOT NULL DEFAULT '',
  read_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cliente_notif_org_phone_idx ON public.cliente_notificacoes (organization_id, customer_phone, created_at DESC);

ALTER TABLE public.cliente_notificacoes ENABLE ROW LEVEL SECURITY;

-- Cliente lê apenas as suas (telefone do profile)
CREATE POLICY "notif customer read own"
  ON public.cliente_notificacoes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND regexp_replace(COALESCE(p.phone,''), '\D', '', 'g')
            = regexp_replace(cliente_notificacoes.customer_phone, '\D', '', 'g')
        AND length(regexp_replace(COALESCE(p.phone,''), '\D', '', 'g')) >= 8
    )
    OR public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = cliente_notificacoes.organization_id
        AND (o.owner_id = auth.uid() OR (public.is_master_admin(auth.uid()) AND o.master_id = auth.uid()))
    )
  );

-- Cliente atualiza apenas as suas (read/click)
CREATE POLICY "notif customer update own"
  ON public.cliente_notificacoes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND regexp_replace(COALESCE(p.phone,''), '\D', '', 'g')
            = regexp_replace(cliente_notificacoes.customer_phone, '\D', '', 'g')
        AND length(regexp_replace(COALESCE(p.phone,''), '\D', '', 'g')) >= 8
    )
  );

-- Dispatcher (lojista aprova sugestão → cria notificações em massa)
CREATE OR REPLACE FUNCTION public.notify_audience(
  _org uuid,
  _suggestion_key text,
  _title text,
  _body text,
  _cta_route text,
  _coupon text,
  _phones text[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  IF NOT public.user_owns_org(_org, v_uid) THEN RETURN 0; END IF;
  IF _phones IS NULL OR array_length(_phones, 1) IS NULL THEN RETURN 0; END IF;

  FOREACH v_phone IN ARRAY _phones LOOP
    v_phone := regexp_replace(COALESCE(v_phone,''), '\D', '', 'g');
    IF length(v_phone) >= 8 THEN
      INSERT INTO public.cliente_notificacoes
        (organization_id, customer_phone, suggestion_key, title, body, cta_route, coupon_code)
      VALUES
        (_org, v_phone, COALESCE(_suggestion_key,''), _title, COALESCE(_body,''),
         COALESCE(_cta_route,''), COALESCE(_coupon,''));
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.cliente_notificacoes;