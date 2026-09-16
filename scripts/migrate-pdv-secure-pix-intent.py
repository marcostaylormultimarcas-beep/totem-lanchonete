from pathlib import Path
p=Path('src/pages/PDV.tsx')
s=p.read_text(encoding='utf-8')
old='''        const { data, error } = await supabase.functions.invoke("mercadopago-create-pix", {
          body: {
            organization_id: operador.organization_id,
            amount: total,
            description: `PDV ${operador.org_name}`,
          },
        });
        if (myReq !== pixReqId.current) return; // resposta atrasada — ignora
        if (error || !(data as any)?.ok) {
          setPixData(null);
          return;
        }
        const d = data as any;
        setPixData({
          qrBase64: d.qr_code_base64 || "",
          copiaECola: d.qr_code || "",
          amount: total,
        });
'''
new='''        const pixItems = cart.map((x) => ({ product_id: x.product_id, quantity: x.quantity }));
        const { data: intentData, error: intentError } = await pdvRpc.createPixIntent(
          sessionToken,
          caixaId,
          pixItems,
          cupomDesc?.codigo || "",
        );
        const intent = intentData as any;
        if (myReq !== pixReqId.current) return;
        if (intentError || !intent?.ok || !intent?.intent_id) {
          setPixData(null);
          return;
        }
        const { data, error } = await supabase.functions.invoke("mercadopago-create-pix", {
          body: { intent_id: intent.intent_id, session_token: sessionToken },
        });
        if (myReq !== pixReqId.current) return; // resposta atrasada — ignora
        if (error || !(data as any)?.ok) {
          setPixData(null);
          return;
        }
        const d = data as any;
        setPixData({
          qrBase64: d.qr_code_base64 || "",
          copiaECola: d.qr_code || "",
          amount: Number(d.amount ?? intent.amount) || 0,
        });
'''
if s.count(old)!=1: raise SystemExit(f'PIX guard failed: {s.count(old)}')
s=s.replace(old,new,1)
olddeps='''  }, [forma, total, operador.organization_id, operador.org_name, pixData]);'''
newdeps='''  }, [forma, total, cart, cupomDesc?.codigo, sessionToken, caixaId, pixData]);'''
if s.count(olddeps)!=1: raise SystemExit(f'PIX deps guard failed: {s.count(olddeps)}')
s=s.replace(olddeps,newdeps,1)
for forbidden in ['organization_id: operador.organization_id','amount: total,\n            description: `PDV ${operador.org_name}`']:
    if forbidden in s: raise SystemExit('invariant failed: insecure PIX browser authority remains')
if 'pdvRpc.createPixIntent(' not in s or 'intent_id: intent.intent_id' not in s or 'session_token: sessionToken' not in s:
    raise SystemExit('invariant failed: secure PIX contract missing')
p.write_text(s,encoding='utf-8')
print('Secure PIX intent frontend migration applied')
