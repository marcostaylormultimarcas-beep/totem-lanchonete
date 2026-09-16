from pathlib import Path

path = Path('src/pages/PDV.tsx')
text = path.read_text(encoding='utf-8')

old_type = 'const [pixData, setPixData] = useState<{ qrBase64: string; copiaECola: string; amount: number; intentId: string } | null>(null);'
new_type = 'const [pixData, setPixData] = useState<{ qrBase64: string; copiaECola: string; amount: number; intentId: string; cartSignature: string } | null>(null);'
old_guard = '''    // Reutiliza o QR se o valor não mudou\n    if (pixData && Math.abs(pixData.amount - total) < 0.005) return;'''
new_guard = '''    const cartSignature = JSON.stringify(\n      cart\n        .map((x) => ({ product_id: x.product_id, quantity: x.quantity }))\n        .sort((a, b) => a.product_id.localeCompare(b.product_id)),\n    );\n    // Reutiliza o QR somente se valor, itens/quantidades e cupom continuarem iguais.\n    if (\n      pixData &&\n      Math.abs(pixData.amount - total) < 0.005 &&\n      pixData.cartSignature === `${cartSignature}|${cupomDesc?.codigo || ""}`\n    ) return;'''
old_set = '''          amount: Number(d.amount ?? intent.amount) || 0,\n          intentId: String(d.intent_id || intent.intent_id),'''
new_set = '''          amount: Number(d.amount ?? intent.amount) || 0,\n          intentId: String(d.intent_id || intent.intent_id),\n          cartSignature: `${cartSignature}|${cupomDesc?.codigo || ""}`,'''

for needle, replacement, label in [
    (old_type, new_type, 'pixData type'),
    (old_guard, new_guard, 'reuse guard'),
    (old_set, new_set, 'pixData assignment'),
]:
    count = text.count(needle)
    if count != 1:
        raise SystemExit(f'Guard failed for {label}: expected 1 match, found {count}')
    text = text.replace(needle, replacement, 1)

if 'pixData.cartSignature' not in text:
    raise SystemExit('Postcondition failed: cart signature guard missing')

path.write_text(text, encoding='utf-8')
print('PDV PIX cart-signature hardening applied safely')
