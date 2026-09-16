-- VisionFood V2 phase 14: session-based cash operations + canonical product barcode.
-- Non-destructive migration.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS codigo_barras text;
CREATE INDEX IF NOT EXISTS idx_products_codigo_barras
  ON public.products(organization_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pdv_abrir_caixa_v2(_session_token text, _saldo_inicial numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','extensions'
AS $$
DECLARE
  v_ctx jsonb; v_op uuid; v_org uuid; v_name text; v_existing uuid; v_id uuid;
BEGIN
  v_ctx := public.pdv_session_context(_session_token);
  IF NOT coalesce((v_ctx->>'ok')::boolean,false) THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;
  v_op := (v_ctx->>'operador_id')::uuid; v_org := (v_ctx->>'organization_id')::uuid;
  SELECT id INTO v_existing FROM public.caixas_pdv WHERE organization_id=v_org AND operador_id=v_op AND status='open' ORDER BY abertura_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason','already_open','caixa_id',v_existing); END IF;
  SELECT coalesce(name,nome,username,usuario,login,'Operador') INTO v_name FROM public.operadores_pdv WHERE id=v_op AND organization_id=v_org;
  INSERT INTO public.caixas_pdv(organization_id,operador_id,status,saldo_inicial)
  VALUES(v_org,v_op,'open',greatest(coalesce(_saldo_inicial,0),0)) RETURNING id INTO v_id;
  INSERT INTO public.caixa_movimentos(caixa_id,organization_id,operador_id,operador_nome,tipo,forma_pagamento,valor,motivo)
  VALUES(v_id,v_org,v_op,coalesce(v_name,'Operador'),'abertura','dinheiro',greatest(coalesce(_saldo_inicial,0),0),'Abertura de caixa');
  RETURN jsonb_build_object('ok',true,'caixa_id',v_id);
END $$;

CREATE OR REPLACE FUNCTION public.pdv_registrar_movimento_v2(_session_token text,_caixa_id uuid,_tipo text,_forma text,_valor numeric,_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE v_ctx jsonb; v_op uuid; v_org uuid; v_name text;
BEGIN
  v_ctx:=public.pdv_session_context(_session_token);
  IF NOT coalesce((v_ctx->>'ok')::boolean,false) THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;
  v_op:=(v_ctx->>'operador_id')::uuid; v_org:=(v_ctx->>'organization_id')::uuid;
  IF _tipo NOT IN ('sangria','suprimento') OR coalesce(_valor,0)<=0 THEN RETURN jsonb_build_object('ok',false,'reason','invalid_movement'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.caixas_pdv WHERE id=_caixa_id AND organization_id=v_org AND operador_id=v_op AND status='open') THEN RETURN jsonb_build_object('ok',false,'reason','invalid_cash'); END IF;
  SELECT coalesce(name,nome,username,usuario,login,'Operador') INTO v_name FROM public.operadores_pdv WHERE id=v_op AND organization_id=v_org;
  INSERT INTO public.caixa_movimentos(caixa_id,organization_id,operador_id,operador_nome,tipo,forma_pagamento,valor,motivo)
  VALUES(_caixa_id,v_org,v_op,coalesce(v_name,'Operador'),_tipo,coalesce(nullif(_forma,''),'dinheiro'),_valor,left(coalesce(_motivo,''),500));
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.pdv_fechar_caixa_v2(_session_token text,_caixa_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_ctx jsonb; v_op uuid; v_org uuid; v_inicial numeric:=0; v_din numeric:=0; v_pix numeric:=0; v_cart numeric:=0;
  v_sang numeric:=0; v_sup numeric:=0; v_dev numeric:=0; v_final numeric:=0; v_resumo jsonb;
BEGIN
  v_ctx:=public.pdv_session_context(_session_token);
  IF NOT coalesce((v_ctx->>'ok')::boolean,false) THEN RETURN jsonb_build_object('ok',false,'reason','invalid_session'); END IF;
  v_op:=(v_ctx->>'operador_id')::uuid; v_org:=(v_ctx->>'organization_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.caixas_pdv WHERE id=_caixa_id AND organization_id=v_org AND operador_id=v_op AND status='open') THEN RETURN jsonb_build_object('ok',false,'reason','invalid_cash'); END IF;
  SELECT coalesce(sum(valor) filter(where tipo='abertura'),0), coalesce(sum(valor) filter(where tipo='venda' and forma_pagamento='dinheiro'),0),
         coalesce(sum(valor) filter(where tipo='venda' and forma_pagamento='pix'),0), coalesce(sum(valor) filter(where tipo='venda' and forma_pagamento='cartao'),0),
         coalesce(sum(valor) filter(where tipo='sangria'),0), coalesce(sum(valor) filter(where tipo='suprimento'),0), coalesce(sum(valor) filter(where tipo='devolucao'),0)
    INTO v_inicial,v_din,v_pix,v_cart,v_sang,v_sup,v_dev
    FROM public.caixa_movimentos WHERE caixa_id=_caixa_id AND organization_id=v_org;
  v_final:=v_inicial+v_din+v_sup-v_sang-v_dev;
  v_resumo:=jsonb_build_object('saldo_inicial',v_inicial,'vendas_dinheiro',v_din,'vendas_pix',v_pix,'vendas_cartao',v_cart,'total_vendas',v_din+v_pix+v_cart,'sangrias',v_sang,'suprimentos',v_sup,'devolucoes',v_dev,'saldo_final_dinheiro',v_final);
  UPDATE public.caixas_pdv SET status='closed',saldo_final=v_final,fechamento_at=now(),resumo=v_resumo,updated_at=now()
   WHERE id=_caixa_id AND organization_id=v_org AND operador_id=v_op AND status='open';
  RETURN jsonb_build_object('ok',true,'resumo',v_resumo);
END $$;

REVOKE ALL ON FUNCTION public.pdv_abrir_caixa_v2(text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdv_registrar_movimento_v2(text,uuid,text,text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdv_fechar_caixa_v2(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdv_abrir_caixa_v2(text,numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_registrar_movimento_v2(text,uuid,text,text,numeric,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_fechar_caixa_v2(text,uuid) TO anon, authenticated;
