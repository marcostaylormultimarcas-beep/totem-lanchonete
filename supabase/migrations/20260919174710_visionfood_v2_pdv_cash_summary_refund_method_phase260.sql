-- VisionFood V2 PHASE 260
-- Fix only public.pdv_caixa_resumo_v2(text, uuid).
-- Refunds retain the original payment method; only cash refunds reduce the physical cash drawer.

CREATE OR REPLACE FUNCTION public.pdv_caixa_resumo_v2(
  _session_token text,
  _caixa_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
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
BEGIN
  v_ctx := public.pdv_session_context(_session_token);
  IF NOT coalesce((v_ctx->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session');
  END IF;

  v_op := (v_ctx->>'operador_id')::uuid;
  v_org := (v_ctx->>'organization_id')::uuid;

  SELECT status
    INTO v_status
    FROM public.caixas_pdv
   WHERE id = _caixa_id
     AND organization_id = v_org
     AND operador_id = v_op
   LIMIT 1;

  IF v_status IS NULL THEN
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
    coalesce(sum(valor) FILTER (WHERE tipo = 'devolucao' AND forma_pagamento = 'dinheiro'), 0)
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

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_status,
    'resumo', jsonb_build_object(
      'saldo_inicial', v_inicial,
      'vendas_dinheiro', v_din,
      'vendas_pix', v_pix,
      'vendas_cartao', v_cart,
      'total_vendas', v_din + v_pix + v_cart,
      'sangrias', v_sang,
      'suprimentos', v_sup,
      'devolucoes', v_dev,
      'saldo_final_dinheiro', v_inicial + v_din + v_sup - v_sang - v_dev_din
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.pdv_caixa_resumo_v2(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_caixa_resumo_v2(text, uuid) TO anon, authenticated, service_role;
