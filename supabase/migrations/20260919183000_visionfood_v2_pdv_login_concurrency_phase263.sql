-- VisionFood V2 PHASE 263
-- Fix only public.pdv_create_session(text,text,text).
-- Anonymous exposure remains intentional because this is the PDV login surface.
-- Serialize concurrent first attempts for the same organization/operator identity
-- so the brute-force counter cannot lose increments when the row does not yet exist.

CREATE OR REPLACE FUNCTION public.pdv_create_session(
  _org_slug text,
  _username text,
  _password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org public.organizations%rowtype;
  v_op public.operadores_pdv%rowtype;
  v_cred text;
  v_token text;
  v_hash text;
  v_caixa uuid;
  v_key text;
  v_attempt private.pdv_login_attempts%rowtype;
  v_next integer;
BEGIN
  IF nullif(btrim(coalesce(_org_slug, '')), '') IS NULL
     OR nullif(btrim(coalesce(_username, '')), '') IS NULL
     OR _password IS NULL
     OR length(_org_slug) > 120
     OR length(_username) > 120
     OR length(_password) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  END IF;

  v_key := encode(
    extensions.digest(
      lower(btrim(_org_slug)) || E'\n' || lower(btrim(_username)),
      'sha256'
    ),
    'hex'
  );

  -- Ensure a row exists before SELECT ... FOR UPDATE. Without this seed row,
  -- concurrent first attempts can both observe "not found" and both persist
  -- attempts=1, weakening the five-attempt lockout.
  INSERT INTO private.pdv_login_attempts(
    attempt_key,
    attempts,
    blocked_until,
    updated_at
  )
  VALUES(v_key, 0, NULL, now())
  ON CONFLICT(attempt_key) DO NOTHING;

  SELECT *
    INTO v_attempt
    FROM private.pdv_login_attempts
   WHERE attempt_key = v_key
   FOR UPDATE;

  IF found
     AND v_attempt.blocked_until IS NOT NULL
     AND v_attempt.blocked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'too_many_attempts',
      'retry_after_seconds',
      greatest(
        1,
        ceil(extract(epoch FROM (v_attempt.blocked_until - now())))::integer
      )
    );
  END IF;

  SELECT *
    INTO v_org
    FROM public.organizations
   WHERE lower(slug) = lower(btrim(_org_slug))
   LIMIT 1;

  IF v_org.id IS NOT NULL THEN
    SELECT *
      INTO v_op
      FROM public.operadores_pdv o
     WHERE o.organization_id = v_org.id
       AND lower(btrim(coalesce(o.usuario, o.login, o.username, o.nome, ''))) =
           lower(btrim(_username))
       AND coalesce(o.ativo, o.active, true) = true
     LIMIT 1;
  END IF;

  v_cred := coalesce(v_op.senha, v_op.password, v_op.pin);

  IF v_org.id IS NULL
     OR v_op.id IS NULL
     OR v_cred IS NULL
     OR v_cred NOT LIKE '$2%'
     OR extensions.crypt(_password, v_cred) <> v_cred THEN

    v_next := CASE
      WHEN found
       AND coalesce(v_attempt.blocked_until, '-infinity'::timestamptz) <= now()
        THEN coalesce(v_attempt.attempts, 0) + 1
      ELSE 1
    END;

    INSERT INTO private.pdv_login_attempts(
      attempt_key,
      attempts,
      blocked_until,
      updated_at
    )
    VALUES(
      v_key,
      v_next,
      CASE WHEN v_next >= 5 THEN now() + interval '10 minutes' ELSE NULL END,
      now()
    )
    ON CONFLICT(attempt_key) DO UPDATE
      SET attempts = excluded.attempts,
          blocked_until = excluded.blocked_until,
          updated_at = now();

    IF v_next >= 5 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'too_many_attempts',
        'retry_after_seconds', 600
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'invalid_credentials',
      'remaining_attempts', 5 - v_next
    );
  END IF;

  DELETE FROM private.pdv_login_attempts
   WHERE attempt_key = v_key;

  IF coalesce(v_org.ativo, true) IS NOT true
     OR coalesce(v_org.bloqueado, false) IS true
     OR coalesce(v_org.status, 'ativo') <> 'ativo'
     OR coalesce(v_org.status_assinatura, 'ativo') <> 'ativo' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'organization_unavailable');
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.pdv_sessions(
    token_hash,
    operador_id,
    organization_id,
    store_id
  )
  VALUES(
    v_hash,
    v_op.id,
    v_op.organization_id,
    v_op.store_id
  );

  SELECT id
    INTO v_caixa
    FROM public.caixas_pdv
   WHERE operador_id = v_op.id
     AND organization_id = v_op.organization_id
     AND status IN ('open', 'aberto')
   ORDER BY abertura_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'session_token', v_token,
    'expires_in_seconds', 43200,
    'operador', jsonb_build_object(
      'id', v_op.id,
      'name', coalesce(v_op.name, v_op.nome, v_op.username),
      'username', coalesce(v_op.username, v_op.usuario, v_op.login),
      'organization_id', v_op.organization_id,
      'org_slug', v_org.slug,
      'org_name', v_org.name,
      'store_id', v_op.store_id,
      'role', v_op.role
    ),
    'caixa_aberto_id', v_caixa
  );
END
$function$;

REVOKE ALL ON FUNCTION public.pdv_create_session(text,text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_create_session(text,text,text)
  TO anon, authenticated, service_role;
