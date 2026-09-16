from pathlib import Path
p=Path('src/pages/PDV.tsx')
s=p.read_text(encoding='utf-8')
old='''    const { data, error } = await pdvRpc.refund(sessionToken, caixaId, order.id, devolvidos, valorTotal, motivo.trim());
    setLoading(false);
    if (error || !(data as any)?.ok) return toast.error("Falha ao processar devolução");
    toast.success(`Devolução de ${fmt(valorTotal)} registrada`);
    onClose();
'''
new='''    const { data, error } = await pdvRpc.refund(sessionToken, caixaId, order.id, devolvidos, valorTotal, motivo.trim());
    setLoading(false);
    const res = data as any;
    if (error || !res?.ok) return toast.error("Falha ao processar devolução");
    const canonicalRefund = Number(res.valor_devolucao) || 0;
    toast.success(`Devolução de ${fmt(canonicalRefund)} registrada`);
    onClose();
'''
if s.count(old)!=1: raise SystemExit(f'refund guard failed: {s.count(old)}')
s=s.replace(old,new,1)
if 'fmt(valorTotal)} registrada' in s: raise SystemExit('invariant failed: client refund amount remains authoritative in success toast')
if 'Number(res.valor_devolucao)' not in s: raise SystemExit('invariant failed: canonical refund amount missing')
p.write_text(s,encoding='utf-8')
print('Canonical refund UI migration applied')
