from pathlib import Path

p=Path('src/components/admin/RoteirizacaoIAPanel.tsx')
s=p.read_text(); old=s
s=s.replace(".eq('status', 'preparing')\n        .eq('order_type', 'delivery')", ".eq('status', 'ready')\n        .in('order_type', ['delivery', 'viagem'])")
s=s.replace(".update({ status: 'out_for_delivery', entregador_id: route.entregadorId, updated_at: new Date().toISOString() })\n        .in('id', ids);", ".update({ status: 'out_for_delivery', entregador_id: route.entregadorId, updated_at: new Date().toISOString() })\n        .eq('organization_id', organizationId)\n        .eq('status', 'ready')\n        .in('order_type', ['delivery', 'viagem'])\n        .in('id', ids)\n        .select('id');")
s=s.replace("if (error) { alert('Erro ao despachar: ' + error.message); setDispatching(null); return; }", "if (error) { alert('Erro ao despachar: ' + error.message); setDispatching(null); return; }\n      if ((updatedOrders || []).length !== ids.length) { alert('Algum pedido mudou de status antes do despacho. Atualize as rotas e tente novamente.'); await loadAll(); setRoutes([]); setGenerated(false); return; }")
s=s.replace("const { error } = await supabase", "const { data: updatedOrders, error } = await supabase", 1)
s=s.replace("Nenhum pedido em preparo aguardando rota.", "Nenhum pedido pronto aguardando rota.")

required=[".eq('status', 'ready')", ".in('order_type', ['delivery', 'viagem'])", ".eq('organization_id', organizationId)", "data: updatedOrders", "updatedOrders || []", "Nenhum pedido pronto aguardando rota."]
if s==old:
    if all(x in s for x in required): print('routing contract already hardened'); raise SystemExit(0)
    raise SystemExit('expected routing anchors not found')
if not all(x in s for x in required): raise SystemExit('routing hardening incomplete')
p.write_text(s)
