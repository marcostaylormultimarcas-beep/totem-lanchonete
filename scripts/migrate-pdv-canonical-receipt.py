from pathlib import Path

p = Path('src/pages/PDV.tsx')
s = p.read_text(encoding='utf-8')

old = '''    toast.success(`Venda registrada — ${fmt(snapTotal)}`);
    beep();
'''
new = '''    const canonicalSubtotal = Number(res.subtotal ?? snapSubtotal);
    const canonicalDesconto = Number(res.desconto ?? snapDesconto);
    const canonicalTotal = Number(res.total ?? snapTotal);
    const canonicalItems = Array.isArray(res.items)
      ? res.items.map((x: any) => ({
          id: String(x.product_id),
          product_id: String(x.product_id),
          name: String(x.name || "Produto"),
          price: Number(x.price) || 0,
          quantity: Number(x.quantity) || 0,
        }))
      : snapshot;
    toast.success(`Venda registrada — ${fmt(canonicalTotal)}`);
    beep();
'''
if s.count(old) != 1:
    raise SystemExit(f'guard failed: expected one sale success block, got {s.count(old)}')
s = s.replace(old, new, 1)

old_receipt = '''      items: snapshot,
      subtotal: snapSubtotal,
      desconto: snapDesconto,
      total: snapTotal,
'''
new_receipt = '''      items: canonicalItems,
      subtotal: canonicalSubtotal,
      desconto: canonicalDesconto,
      total: canonicalTotal,
'''
if s.count(old_receipt) != 1:
    raise SystemExit(f'guard failed: expected one receipt snapshot block, got {s.count(old_receipt)}')
s = s.replace(old_receipt, new_receipt, 1)

segment = s[s.index('const finalizar = async () =>'):s.index('  return (', s.index('const finalizar = async () =>'))]
if 'toast.success(`Venda registrada — ${fmt(snapTotal)}`)' in segment:
    raise SystemExit('safety invariant failed: sale toast still trusts client total')
if 'total: snapTotal' in segment or 'items: snapshot' in segment:
    raise SystemExit('safety invariant failed: receipt still trusts client sale values')
if 'canonicalTotal' not in segment or 'canonicalItems' not in segment:
    raise SystemExit('safety invariant failed: canonical receipt values missing')

p.write_text(s, encoding='utf-8')
print('PDV canonical receipt migration applied')
