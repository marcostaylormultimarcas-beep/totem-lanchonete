-- VisionFood V2 PHASE 265
-- Fix only public.pdv_fechar_caixa_v2(text, uuid).
-- Anonymous exposure remains intentional because PDV clients authenticate with
-- the opaque server-issued _session_token validated by pdv_session_context().
--
-- Hardening:
-- 1) serialize concurrent close attempts on the cash-register row;
-- 2) accept the two active status spellings already used by the PDV contract;
-- 3) persist the physical cash balance using only cash refunds;
-- 4) preserve the full refund total in the returned/persisted summary.

CREATE OR REPLACE FUNCTION public.pdv_fechar_caixa_v2(
  _session_token text,
  _caixa_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ctx jsonb;
  v_op uuid;
  v_org uuid;
  v_status text;

  v_inicial numeric := 0;
  v_din numeric := 0;
  v_pix numeric := 0;
  v_cart numeric := 0;
  v_sang numeric := 0;
  v_sup numeric := 0;
  v_dev numeric := 0;
  v_dev_din numeric := 0;
  v_final numeric := 0;
  v_resumo jsonb;
BEGIN
  v_ctx := public.pdv_session_context(_session_token);

  IF NOT coalesce((v_ctx->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session');
  END IF;

  v_op := (v_ctx->>'operador_id')::uuid;
  v_org := (v_ctx->>'organization_id')::uuid;

  -- Lock this cash register before checking its state. A concurrent close waits
  -- and then observes the committed closed state instead of returning a second
  -- false-positive success.
  SELECT status
    INTO v_status
    FROM public.caixas_pdv
   WHERE id = _caixa_id
     AND organization_id = v_org
     AND operador_id = v_op
   FOR UPDATE;

  IF v_status IS NULL
     OR v_status NOT IN ('open', 'aberto') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_cash');
  END IF;

  SELECT
    coalesce(sum(valor) FILTER (WHERE tipo = 'abertura'), 0),
    coalesce(sum(valor) FILTER (WHERE tipo = 'venda' AND forma_pagamento = 'dinheiro'), 0),
    coalesce(sum(valor) FILTER (WHERE tipo = 'venda' AND forma_pagamento = 'pix'), 0),
    coalesce(sum(valor) FILTER (WHERE tipo = 'venda' AND forma_pagamento = 'cartao'), 0),
    coalesce(sum(valor) FILTER (WHERE tipo = 'sangria'), 0),
    coalesce(sum(valor) FILTER (WHERE tipo = 'suprimento'), 0),
    coalesce(sum(valor) FILTER (WHERE tipo = 'devolucao'), 0),
    coalesce(sum(valor) FILTER (
      WHERE tipo = 'devolucao'
        AND forma_pagamento = 'dinheiro'
    ), 0)
  INTO
    v_inicial,
    v_din,
    v_pix,
    v_cart,
    v_sang,
    v_sup,
    v_dev,
    v_dev_din
  FROM public.caixa_movimentos
  WHERE caixa_id = _caixa_id
    AND organization_id = v_org;

  -- PIX/card refunds remain in the financial refund total but do not physically
  -- remove money from the cash drawer.
  v_final := v_inicial + v_din + v_sup - v_sang - v_dev_din;

  v_resumo := jsonb_build_object(
    'saldo_inicial', v_inicial,
    'vendas_dinheiro', v_din,
    'vendas_pix', v_pix,
    'vendas_cartao', v_cart,
    'total_vendas', v_din + v_pix + v_cart,
    'sangrias', v_sang,
    'suprimentos', v_sup,
    'devolucoes', v_dev,
    'saldo_final_dinheiro', v_final
  );

  UPDATE public.caixas_pdv
     SET status = 'closed',
         saldo_final = v_final,
         fechamento_at = now(),
         resumo = v_resumo,
         updated_at = now()
   WHERE id = _caixa_id
     AND organization_id = v_org
     AND operador_id = v_op
     AND status IN ('open', 'aberto');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_cash');
  END IF;

  RETURN jsonb_build_object('ok', true, 'resumo', v_resumo);
END
$function$;

REVOKE ALL ON FUNCTION public.pdv_fechar_caixa_v2(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_fechar_caixa_v2(text, uuid)
TO anon, authenticated, service_role;
