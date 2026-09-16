from pathlib import Path
p=Path('src/pages/PDV.tsx')
s=p.read_text(encoding='utf-8')
old_catalog='''      const { data } = await supabase
        .from("products")
        .select("id,name,price,codigo_barras,available,image")
        .eq("organization_id", operador.organization_id)
        .eq("available", true)
        .order("name");
      setProducts((data as Product[]) || []);
'''
new_catalog='''      const { data, error } = await pdvRpc.catalog(sessionToken);
      const res = data as any;
      if (error || !res?.ok) {
        console.error("[PDV] secure catalog load failed", error || res?.reason);
        setProducts([]);
        toast.error("Não foi possível carregar os produtos do PDV");
        return;
      }
      setProducts((res.products as Product[]) || []);
'''
if s.count(old_catalog)!=1: raise SystemExit(f'catalog guard failed: {s.count(old_catalog)}')
s=s.replace(old_catalog,new_catalog,1)
s=s.replace('''  }, [operador.organization_id]);''','''  }, [sessionToken]);''',1)
old_coupon='''    const { data } = await supabase
      .from("cupons")
      .select("codigo,tipo,valor,status,data_inicio,data_fim")
      .eq("organization_id", operador.organization_id)
      .ilike("codigo", c)
      .maybeSingle();
    if (!data) return toast.error("Cupom não encontrado");
    if ((data as any).status && (data as any).status !== "ativo")
      return toast.error("Cupom inativo");
    const now = new Date();
    if ((data as any).data_inicio && new Date((data as any).data_inicio) > now)
      return toast.error("Cupom ainda não iniciou");
    if ((data as any).data_fim && new Date((data as any).data_fim) < now)
      return toast.error("Cupom expirado");
    setCupomDesc({
      codigo: (data as any).codigo,
      tipo: (data as any).tipo,
      valor: Number((data as any).valor) || 0,
    });
    toast.success(`Cupom ${(data as any).codigo} aplicado`);
'''
new_coupon='''    const { data, error } = await pdvRpc.validateCoupon(sessionToken, c);
    const res = data as any;
    if (error) return toast.error(error.message);
    if (!res?.ok) {
      const messages: Record<string, string> = {
        not_found: "Cupom não encontrado",
        inactive: "Cupom inativo",
        not_started: "Cupom ainda não iniciou",
        expired: "Cupom expirado",
        invalid_session: "Sessão do PDV expirada",
      };
      return toast.error(messages[res?.reason] || "Cupom inválido");
    }
    const cupom = res.cupom as any;
    setCupomDesc({
      codigo: cupom.codigo,
      tipo: cupom.tipo,
      valor: Number(cupom.valor) || 0,
    });
    toast.success(`Cupom ${cupom.codigo} aplicado`);
'''
if s.count(old_coupon)!=1: raise SystemExit(f'coupon guard failed: {s.count(old_coupon)}')
s=s.replace(old_coupon,new_coupon,1)
segment=s[s.index('function PDVMain('):s.index('/* --------------------------- MODAL SANGRIA',s.index('function PDVMain('))]
if '.from("products")' in segment or '.from("cupons")' in segment: raise SystemExit('invariant failed: direct PDV catalog/coupon table access remains')
if 'pdvRpc.catalog(sessionToken)' not in segment or 'pdvRpc.validateCoupon(sessionToken, c)' not in segment: raise SystemExit('invariant failed: secure RPC calls missing')
p.write_text(s,encoding='utf-8')
print('PDV session catalog/coupon migration applied')
