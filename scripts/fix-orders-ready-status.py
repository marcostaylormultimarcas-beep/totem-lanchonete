from pathlib import Path

p = Path('src/components/admin/OrdersPanel.tsx')
s = p.read_text()

# A stronger lifecycle hardening may already be present from an earlier round.
# In that case, do not rewrite the component: just validate the required contract.
already_hardened = all([
    "ready:{label:'🔔 Pronto'" in s or "ready: { label: '🔔 Pronto'" in s or "ready: { label: '✅ Pronto'" in s,
    "['pending','preparing','ready','out_for_delivery']" in s or "['pending', 'preparing', 'ready', 'out_for_delivery']" in s,
    "next==='ready'" in s or "updateStatus(order.id, 'ready')" in s,
    "status==='ready'" in s,
    "if(error||!updated||updated.status!==status)" in s or "Falha ao atualizar status do pedido" in s,
])
if already_hardened:
    print('ready flow already hardened')
    raise SystemExit(0)

s = s.replace(
    "  preparing: { label: '👨‍🍳 Preparando', color: 'text-primary', bg: 'bg-primary/20' },\n",
    "  preparing: { label: '👨‍🍳 Preparando', color: 'text-primary', bg: 'bg-primary/20' },\n  ready: { label: '✅ Pronto', color: 'text-success', bg: 'bg-success/20' },\n",
)
s = s.replace(
    "query = query.in('status', ['pending', 'preparing', 'out_for_delivery']);",
    "query = query.in('status', ['pending', 'preparing', 'ready', 'out_for_delivery']);",
)
s = s.replace(
    "    await supabase.from('orders').update({ status }).eq('id', id);\n\n    // 🔔",
    "    const { error: statusError } = await supabase.from('orders').update({ status }).eq('id', id);\n    if (statusError) {\n      console.error('orders status update', statusError);\n      toast.error('Falha ao atualizar status do pedido.');\n      return;\n    }\n\n    // 🔔",
)
needle = """                {(order.status === 'pending' || order.status === 'preparing') && (
                  <button
                    onClick={() => updateStatus(order.id, 'out_for_delivery')}
"""
insert = """                {order.status === 'preparing' && (
                  <button
                    onClick={() => updateStatus(order.id, 'ready')}
                    className=\"flex-1 touch-btn py-2 rounded-lg text-sm bg-success/20 text-success border border-success/30 flex items-center justify-center gap-1\"
                  >
                    <CheckCircle2 className=\"w-4 h-4\" /> Pronto
                  </button>
                )}
                {(order.status === 'pending' || order.status === 'preparing' || order.status === 'ready') && (
                  <button
                    onClick={() => updateStatus(order.id, 'out_for_delivery')}
"""
if needle not in s:
    raise SystemExit('status action block not found and hardened lifecycle contract not detected')
s = s.replace(needle, insert)
p.write_text(s)
