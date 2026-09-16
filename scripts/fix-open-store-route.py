from pathlib import Path

helper=Path('src/lib/kioskHome.ts')
s=helper.read_text()
old='''// Retorna o caminho "home" do totem preservando o slug da loja atual, se houver.\nexport function getKioskHomePath(): string {\n  const slug = typeof window !== 'undefined' ? localStorage.getItem('kiosk_slug') : null;\n  return slug ? `/cardapio/${slug}` : '/';\n}\n'''
new='''// Retorna o caminho público do cardápio preservando o slug atual quando não for informado.\nexport function getKioskHomePath(slug?: string | null): string {\n  const resolvedSlug = slug || (typeof window !== 'undefined' ? localStorage.getItem('kiosk_slug') : null);\n  return resolvedSlug ? `/cardapio/${resolvedSlug}` : '/';\n}\n'''
if s.count(old)!=1: raise SystemExit(f'kiosk helper guard failed: {s.count(old)}')
helper.write_text(s.replace(old,new,1))

admin=Path('src/pages/Admin.tsx')
a=admin.read_text()
old="href={`/loja/${activeSlug}`}"
new="href={getKioskHomePath(activeSlug)}"
if a.count(old)!=1: raise SystemExit(f'admin open-store guard failed: {a.count(old)}')
a=a.replace(old,new,1)
admin.write_text(a)
print('canonical open-store route patch applied')
