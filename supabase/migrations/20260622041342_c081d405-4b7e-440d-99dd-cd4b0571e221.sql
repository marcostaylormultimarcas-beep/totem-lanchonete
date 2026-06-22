CREATE OR REPLACE FUNCTION public.pdv_registrar_venda(_operador_id uuid, _password text, _caixa_id uuid, _items jsonb, _forma text, _total numeric, _cupom_code text, _desconto numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_op public.operadores_pdv%ROWTYPE; v_caixa public.caixas_pdv%ROWTYPE; v_order_id uuid; v_order_number text;
BEGIN
  v_op := public.pdv_check(_operador_id, _password);
  IF v_op.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials'); END IF;
  SELECT * INTO v_caixa FROM public.caixas_pdv WHERE id = _caixa_id;
  IF NOT FOUND OR v_caixa.status <> 'open' OR v_caixa.operador_id <> v_op.id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'caixa_invalido');
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_itens');
  END IF;

  v_order_number := 'PDV' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYMMDDHH24MISS') || lpad(floor(random()*1000)::text, 3, '0');

  INSERT INTO public.orders (
    organization_id, status, items, total, order_type, payment_method,
    customer_name, customer_phone, notes, order_number
  ) VALUES (
    v_op.organization_id, 'delivered', _items, COALESCE(_total,0), 'pdv', COALESCE(_forma,'dinheiro'),
    'Balcão', '', CASE WHEN COALESCE(_cupom_code,'') <> '' THEN 'Cupom: '||_cupom_code ELSE '' END,
    v_order_number
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.caixa_movimentos (caixa_id, organization_id, operador_id, operador_nome, tipo, forma_pagamento, valor, motivo, order_id, metadata)
    VALUES (_caixa_id, v_op.organization_id, v_op.id, v_op.name, 'venda', COALESCE(_forma,'dinheiro'), COALESCE(_total,0),
            CASE WHEN COALESCE(_cupom_code,'') <> '' THEN 'Cupom '||_cupom_code ELSE 'Venda PDV' END,
            v_order_id, jsonb_build_object('desconto', COALESCE(_desconto,0), 'cupom', COALESCE(_cupom_code,'')));

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'order_number', v_order_number);
END; $function$;