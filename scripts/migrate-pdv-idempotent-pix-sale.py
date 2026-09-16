from pathlib import Path
p=Path('src/pages/PDV.tsx'); s=p.read_text(encoding='utf-8')
if 'pdvRpc.pixStatus(sessionToken, pixData.intentId)' not in s: raise SystemExit('guard: confirmed PIX flow missing')
# Replace the generic sale call only inside finalizar with an idempotent PIX-specific branch.
old='''      const { data: saleData, error: saleError } = await pdvRpc.sale(sessionToken, caixaId, saleItems, forma, total, cupomDesc?.codigo || "", desconto);'''
new='''      const saleResult = forma === "pix" && pixData?.intentId
        ? await pdvRpc.pixSale(sessionToken, pixData.intentId)
        : await pdvRpc.sale(sessionToken, caixaId, saleItems, forma, total, cupomDesc?.codigo || "", desconto);
      const { data: saleData, error: saleError } = saleResult;'''
if s.count(old)!=1: raise SystemExit(f'generic sale call guard failed: {s.count(old)}')
s=s.replace(old,new,1)
if 'pdvRpc.pixSale(sessionToken, pixData.intentId)' not in s: raise SystemExit('invariant: pixSale missing')
p.write_text(s,encoding='utf-8')
print('idempotent PIX sale frontend migration applied')
