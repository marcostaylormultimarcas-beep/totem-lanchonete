from pathlib import Path

cart = Path('src/components/kiosk/CartScreen.tsx')
s = cart.read_text()

def rep(old, new, count=1):
    global s
    actual = s.count(old)
    if actual != count:
        raise SystemExit(f'Cart guard expected {count}, got {actual}: {old[:100]!r}')
    s = s.replace(old, new, count)

# Both notification and manual application: find by org/code first, then accept either modern status or legacy ativo.
rep(".select('*').eq('organization_id', orgId).eq('codigo', code).eq('status', 'ativo').maybeSingle();",
    ".select('*').eq('organization_id', orgId).ilike('codigo', code).maybeSingle();")
rep("      if (!data) return;\n      const c: any = data;\n      const now = new Date();",
    "      if (!data) return;\n      const c: any = data;\n      const couponEnabled = c.status != null ? c.status === 'ativo' : c.ativo !== false;\n      if (!couponEnabled) return;\n      const now = new Date();", 1)
rep("      .eq('codigo', code)\n      .eq('status', 'ativo')\n      .maybeSingle();",
    "      .ilike('codigo', code)\n      .maybeSingle();")
rep("    const c: any = data;\n    const now = new Date();",
    "    const c: any = data;\n    const couponEnabled = c.status != null ? c.status === 'ativo' : c.ativo !== false;\n    if (!couponEnabled) {\n      toast.error('Este cupom está inativo.');\n      return;\n    }\n    const now = new Date();", 1)
cart.write_text(s)

panel = Path('src/components/admin/CouponsPanel.tsx')
p = panel.read_text()
# Keep current UI contract, but write/read legacy ativo too so old and new consumers agree.
old = "interface Cupom { id:string; codigo:string; tipo:'porcentagem'|'valor_fixo'; valor:number; status:'ativo'|'inativo'; }"
new = "interface Cupom { id:string; codigo:string; tipo:'porcentagem'|'valor_fixo'; valor:number; status:'ativo'|'inativo'; ativo?:boolean|null; }"
if p.count(old) != 1: raise SystemExit('Coupons interface guard failed')
p = p.replace(old,new,1)
old = ".select('id,codigo,tipo,valor,status')"
new = ".select('id,codigo,tipo,valor,status,ativo')"
if p.count(old) != 1: raise SystemExit('Coupons select guard failed')
p = p.replace(old,new,1)
old = "const payload={codigo:code,tipo,valor:v,status:ativo?'ativo':'inativo'};"
new = "const payload={codigo:code,tipo,valor:v,status:ativo?'ativo':'inativo',ativo};"
if p.count(old) != 1: raise SystemExit('Coupons payload guard failed')
p = p.replace(old,new,1)
old = "update({status}).eq('id',c.id)"
new = "update({status,ativo:status==='ativo'}).eq('id',c.id)"
if p.count(old) != 1: raise SystemExit('Coupons toggle guard failed')
p = p.replace(old,new,1)
panel.write_text(p)
print('coupon compatibility patch applied')
