from pathlib import Path
p=Path('src/pages/PDV.tsx')
s=p.read_text(encoding='utf-8')
old='''      const { data } = await supabase
        .from("caixa_movimentos")
        .select("tipo,forma_pagamento,valor")
        .eq("caixa_id", caixaId);
      if (!data) return;
      const sum = (cond: (r: any) => boolean) =>
        data.filter(cond).reduce((s, r: any) => s + Number(r.valor), 0);
      const inicial = sum((r) => r.tipo === "abertura");
      const vDin = sum((r) => r.tipo === "venda" && r.forma_pagamento === "dinheiro");
      const vPix = sum((r) => r.tipo === "venda" && r.forma_pagamento === "pix");
      const vCart = sum((r) => r.tipo === "venda" && r.forma_pagamento === "cartao");
      const sangria = sum((r) => r.tipo === "sangria");
      const suprimento = sum((r) => r.tipo === "suprimento");
      const devolucao = sum((r) => r.tipo === "devolucao");
      setResumo({
        saldo_inicial: inicial,
        vendas_dinheiro: vDin,
        vendas_pix: vPix,
        vendas_cartao: vCart,
        total_vendas: vDin + vPix + vCart,
        sangrias: sangria,
        suprimentos: suprimento,
        devolucoes: devolucao,
        saldo_final_dinheiro: inicial + vDin + suprimento - sangria - devolucao,
      });
'''
new='''      const { data, error } = await pdvRpc.cashSummary(sessionToken, caixaId);
      const res = data as any;
      if (error || !res?.ok || !res?.resumo) {
        toast.error(res?.reason === "invalid_session" ? "Sessão expirada. Entre novamente." : "Falha ao carregar resumo do caixa");
        return;
      }
      setResumo(res.resumo);
'''
if s.count(old)!=1: raise SystemExit(f'guard failed: expected one cash movements preview, got {s.count(old)}')
s=s.replace(old,new,1)
section=s[s.index('function FechamentoModal'):]
if '.from("caixa_movimentos")' in section: raise SystemExit('invariant failed: direct caixa_movimentos read remains in FechamentoModal')
if 'pdvRpc.cashSummary(sessionToken, caixaId)' not in section: raise SystemExit('invariant failed: secure summary missing')
s=s.replace('  }, [caixaId]);','  }, [caixaId, sessionToken]);',1)
p.write_text(s,encoding='utf-8')
print('PDV secure cash summary migration applied')
