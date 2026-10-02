from pathlib import Path

panel = Path('src/components/admin/CouponsPanel.tsx')
p = panel.read_text()
repls = [
("interface Cupom { id:string; codigo:string; tipo:'porcentagem'|'valor_fixo'; valor:number; status:'ativo'|'inativo'; ativo?:boolean|null; }",
 "interface Cupom { id:string; codigo:string; tipo:'porcentagem'|'valor_fixo'; valor:number; status:boolean|null; ativo:boolean|null; }"),
("setAtivo(c.status==='ativo')", "setAtivo(c.status != null ? c.status : c.ativo !== false)"),
("const payload={codigo:code,tipo,valor:v,status:ativo?'ativo':'inativo',ativo};", "const payload={codigo:code,tipo,valor:v,status:ativo,ativo};"),
("const status=c.status==='ativo'?'inativo':'ativo';", "const status=!(c.status != null ? c.status : c.ativo !== false);"),
("update({status,ativo:status==='ativo'})", "update({status,ativo:status})"),
("{...x,status}:x", "{...x,status,ativo:status}:x"),
("c.status==='ativo'?'bg-success/20 text-success':'bg-muted text-muted-foreground'", "(c.status != null ? c.status : c.ativo !== false)?'bg-success/20 text-success':'bg-muted text-muted-foreground'"),
("c.status==='ativo'?'Ativo':'Inativo'", "(c.status != null ? c.status : c.ativo !== false)?'Ativo':'Inativo'"),
]
for old,new in repls:
    n=p.count(old)
    if n != 1: raise SystemExit(f'CouponsPanel guard expected 1 got {n}: {old}')
    p=p.replace(old,new,1)
panel.write_text(p)

cart = Path('src/components/kiosk/CartScreen.tsx')
s=cart.read_text()
old="const couponEnabled = c.status != null ? c.status === 'ativo' : c.ativo !== false;"
new="const couponEnabled = c.status != null ? c.status === true : c.ativo !== false;"
if s.count(old) != 2: raise SystemExit(f'CartScreen guard expected 2 got {s.count(old)}')
s=s.replace(old,new)
cart.write_text(s)
print('coupon boolean contract patch applied')
