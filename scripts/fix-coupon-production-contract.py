from pathlib import Path

panel = Path('src/components/admin/CouponsPanel.tsx')
p = panel.read_text()
replacements = [
("interface Cupom { id:string; codigo:string; tipo:'porcentagem'|'valor_fixo'; valor:number; status:'ativo'|'inativo'; ativo?:boolean|null; }", "interface Cupom { id:string; codigo:string; tipo:'porcentagem'|'valor_fixo'|null; tipo_desconto?:string|null; valor:number; status?:boolean|null; ativo:boolean; }"),
(".select('id,codigo,tipo,valor,status,ativo')", ".select('id,codigo,tipo,tipo_desconto,valor,status,ativo')"),
("const edit=(c:Cupom)=>{setEditingId(c.id);setCodigo(c.codigo);setTipo(c.tipo);setValor(String(c.valor));setAtivo(c.status==='ativo');window.scrollTo({top:0,behavior:'smooth'})};", "const edit=(c:Cupom)=>{setEditingId(c.id);setCodigo(c.codigo);setTipo(c.tipo==='valor_fixo'||c.tipo_desconto==='fixed'?'valor_fixo':'porcentagem');setValor(String(c.valor));setAtivo(c.ativo!==false);window.scrollTo({top:0,behavior:'smooth'})};"),
("const payload={codigo:code,tipo,valor:v,status:ativo?'ativo':'inativo',ativo};", "const payload={codigo:code,tipo,tipo_desconto:tipo==='porcentagem'?'percent':'fixed',valor:v,status:ativo,ativo};"),
("const toggleStatus=async(c:Cupom)=>{if(!organizationId)return;const status=c.status==='ativo'?'inativo':'ativo';const{error}=await supabase.from('cupons' as any).update({status,ativo:status==='ativo'}).eq('id',c.id).eq('organization_id',organizationId);if(error){showDbError('Erro ao atualizar cupom',error);return}setCupons(p=>p.map(x=>x.id===c.id?{...x,status}:x))};", "const toggleStatus=async(c:Cupom)=>{if(!organizationId)return;const next=c.ativo===false;const{error}=await supabase.from('cupons' as any).update({status:next,ativo:next}).eq('id',c.id).eq('organization_id',organizationId);if(error){showDbError('Erro ao atualizar cupom',error);return}setCupons(p=>p.map(x=>x.id===c.id?{...x,status:next,ativo:next}:x))};"),
("${c.tipo==='porcentagem'?`${c.valor}% de desconto`:`R$ ${Number(c.valor).toFixed(2)} fixo`}", "${(c.tipo==='valor_fixo'||c.tipo_desconto==='fixed')?`R$ ${Number(c.valor).toFixed(2)} fixo`:`${c.valor}% de desconto`}"),
("${c.status==='ativo'?'bg-success/20 text-success':'bg-muted text-muted-foreground'}", "${c.ativo!==false?'bg-success/20 text-success':'bg-muted text-muted-foreground'}"),
("{c.status==='ativo'?'Ativo':'Inativo'}", "{c.ativo!==false?'Ativo':'Inativo'}"),
]
for old,new in replacements:
    n=p.count(old)
    if n != 1:
        raise SystemExit(f'CouponsPanel guard expected 1, got {n}: {old[:100]}')
    p=p.replace(old,new,1)
panel.write_text(p)

cart=Path('src/components/kiosk/CartScreen.tsx')
s=cart.read_text()
s=s.replace("const couponEnabled = c.status != null ? c.status === 'ativo' : c.ativo !== false;", "const couponEnabled = c.ativo !== false && c.status !== false;")
s=s.replace("const calc = c.tipo === 'porcentagem' ? (subtotal * Number(c.valor)) / 100 : Number(c.valor);", "const couponType: 'porcentagem' | 'valor_fixo' = (c.tipo === 'valor_fixo' || c.tipo_desconto === 'fixed') ? 'valor_fixo' : 'porcentagem';\n      const calc = couponType === 'porcentagem' ? (subtotal * Number(c.valor)) / 100 : Number(c.valor);")
s=s.replace("onApplyCoupon({ id: c.id, codigo: c.codigo, tipo: c.tipo, valor: Number(c.valor), discount: calc });", "onApplyCoupon({ id: c.id, codigo: c.codigo, tipo: couponType, valor: Number(c.valor), discount: calc });")
if s.count("c.status === 'ativo'"):
    raise SystemExit('legacy text status comparison remains')
if s.count("const couponType") != 2:
    raise SystemExit(f'expected 2 couponType normalizations, got {s.count("const couponType")}')
cart.write_text(s)
print('coupon production contract aligned')
