from pathlib import Path

p = Path('src/pages/PDV.tsx')
s = p.read_text(encoding='utf-8')

old = '''    let q = supabase
      .from("orders")
      .select("id,items,total,status,customer_name,created_at,organization_id")
      .eq("organization_id", operador.organization_id)
      .limit(1);
    // Permitir buscar por uuid completo OU pelos primeiros caracteres
    if (orderId.includes("-") && orderId.length >= 30) {
      q = q.eq("id", orderId.trim());
    } else {
      q = q.ilike("id", `${orderId.trim()}%`);
    }
    const { data } = await q.maybeSingle();
    setLoading(false);
    if (!data) {
      setOrder(null);
      setItems([]);
      return toast.error("Pedido não encontrado");
    }
    setOrder(data);
    const arr = Array.isArray(data.items) ? data.items : [];
'''
new = '''    const { data, error } = await pdvRpc.findOrder(sessionToken, orderId.trim());
    setLoading(false);
    const res = data as any;
    if (error || !res?.ok || !res?.order) {
      setOrder(null);
      setItems([]);
      return toast.error(res?.reason === "invalid_session" ? "Sessão expirada. Entre novamente." : "Pedido não encontrado");
    }
    const dataOrder = res.order;
    setOrder(dataOrder);
    const arr = Array.isArray(dataOrder.items) ? dataOrder.items : [];
'''

count = s.count(old)
if count != 1:
    raise SystemExit(f'guard failed: expected one direct orders lookup block, got {count}')

s = s.replace(old, new, 1)

if '.from("orders")' in s[s.index('function DevolucaoModal'):s.index('function FechamentoModal')]:
    raise SystemExit('safety invariant failed: DevolucaoModal still reads orders directly')
if 'pdvRpc.findOrder(sessionToken, orderId.trim())' not in s:
    raise SystemExit('safety invariant failed: secure lookup missing')

p.write_text(s, encoding='utf-8')
print('PDV secure order lookup migration applied')
