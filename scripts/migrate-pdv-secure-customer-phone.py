from pathlib import Path
p=Path('src/pages/PDV.tsx')
s=p.read_text(encoding='utf-8')
old='''        await supabase
          .from("orders")
          .update({ customer_phone: phoneDigits })
          .eq("id", res.order_id);
'''
new='''        const { data: phoneData, error: phoneError } = await pdvRpc.setOrderCustomerPhone(
          sessionToken,
          res.order_id,
          phoneDigits,
        );
        const phoneRes = phoneData as any;
        if (phoneError || !phoneRes?.ok) {
          console.error("[PDV] secure customer phone update failed", phoneError || phoneRes?.reason);
          toast.error("Venda concluída, mas não foi possível salvar o telefone do cliente");
        }
'''
if s.count(old)!=1:
    raise SystemExit(f'guard failed: expected one direct order phone update, got {s.count(old)}')
s=s.replace(old,new,1)
segment=s[s.index('const finalizar = async () =>'):s.index('  return (',s.index('const finalizar = async () =>'))]
if '.from("orders")' in segment and 'customer_phone' in segment:
    raise SystemExit('invariant failed: direct orders customer phone access remains in finalizar')
if 'pdvRpc.setOrderCustomerPhone(' not in segment:
    raise SystemExit('invariant failed: secure customer phone RPC missing')
p.write_text(s,encoding='utf-8')
print('PDV secure customer phone migration applied')
