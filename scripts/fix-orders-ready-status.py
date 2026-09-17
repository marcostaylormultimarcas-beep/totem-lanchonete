from pathlib import Path
p=Path('src/components/admin/OrdersPanel.tsx')
s=p.read_text()
if "ready: { label: '✅ Pronto'" in s and "Falha ao atualizar status do pedido" in s:
    print('already applied'); raise SystemExit(0)
s=s.replace("  preparing: { label: '👨‍🍳 Preparando', color: 'text-primary', bg: 'bg-primary/20' },\n", "  preparing: { label: '👨‍🍳 Preparando', color: 'text-primary', bg: 'bg-primary/20' },\n  ready: { label: '✅ Pronto', color: 'text-success', bg: 'bg-success/20' },\n")
s=s.replace("query = query.in('status', ['pending', 'preparing', 'out_for_delivery']);", "query = query.in('status', ['pending', 'preparing', 'ready', 'out_for_delivery']);")
s=s.replace("    await supabase.from('orders').update({ status }).eq('id', id);\n\n    // 🔔", "    const { error: statusError } = await supabase.from('orders').update({ status }).eq('id', id);\n    if (statusError) {\n      console.error('orders status update', statusError);\n      toast.error('Falha ao atualizar status do pedido.');\n      return;\n    }\n\n    // 🔔")
needle="""                {(order.status === 'pending' || order.status === 'preparing') && (\n                  <button\n                    onClick={() => updateStatus(order.id, 'out_for_delivery')}\n"""
insert="""                {order.status === 'preparing' && (\n                  <button\n                    onClick={() => updateStatus(order.id, 'ready')}\n                    className=\"flex-1 touch-btn py-2 rounded-lg text-sm bg-success/20 text-success border border-success/30 flex items-center justify-center gap-1\"\n                  >\n                    <CheckCircle2 className=\"w-4 h-4\" /> Pronto\n                  </button>\n                )}\n                {(order.status === 'pending' || order.status === 'preparing' || order.status === 'ready') && (\n                  <button\n                    onClick={() => updateStatus(order.id, 'out_for_delivery')}\n"""
if needle not in s: raise SystemExit('status action block not found')
s=s.replace(needle,insert)
p.write_text(s)
