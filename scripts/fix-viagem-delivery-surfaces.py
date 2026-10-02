from pathlib import Path

files = {
    Path('src/pages/OrderHistory.tsx'): [
        ("order.order_type === 'delivery' && order.delivery_code", "(order.order_type === 'delivery' || order.order_type === 'viagem') && order.delivery_code"),
    ],
    Path('src/components/admin/OrderPrintReceipt.tsx'): [
        ("{order.order_type === 'delivery' ? 'DELIVERY' : order.order_type === 'retirada' ? 'RETIRADA' : 'COMER NO LOCAL'}", "{order.order_type === 'delivery' || order.order_type === 'viagem' ? 'DELIVERY' : order.order_type === 'retirada' ? 'RETIRADA' : 'COMER NO LOCAL'}"),
        ("{order.order_type === 'delivery' && (", "{(order.order_type === 'delivery' || order.order_type === 'viagem') && ("),
    ],
}

changed = False
for path, replacements in files.items():
    s = path.read_text()
    original = s
    for old, new in replacements:
        if old in s:
            s = s.replace(old, new)
        elif new not in s:
            raise SystemExit(f'expected anchor not found in {path}: {old}')
    if s != original:
        path.write_text(s)
        changed = True

required = {
    'src/pages/OrderHistory.tsx': "(order.order_type === 'delivery' || order.order_type === 'viagem') && order.delivery_code",
    'src/components/admin/OrderPrintReceipt.tsx': "order.order_type === 'delivery' || order.order_type === 'viagem' ? 'DELIVERY'",
}
for f, needle in required.items():
    if needle not in Path(f).read_text():
        raise SystemExit(f'contract missing: {f}')

print('viagem delivery surfaces aligned' if changed else 'viagem delivery surfaces already aligned')
