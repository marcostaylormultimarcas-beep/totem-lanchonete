from pathlib import Path

helper=Path('src/lib/kioskHome.ts')
s=helper.read_text()
old='''// Retorna o caminho "home" do totem preservando o slug da loja atual, se houver.\nexport function getKioskHomePath(): string {\n  const slug = typeof window !== 'undefined' ? localStorage.getItem('kiosk_slug') : null;\n  return slug ? `/cardapio/${slug}` : '/';\n}\n'''
new='''// Retorna o caminho público do cardápio preservando o slug atual quando não for informado.\nexport function getKioskHomePath(slug?: string | null): string {\n  const resolvedSlug = slug || (typeof window !== 'undefined' ? localStorage.getItem('kiosk_slug') : null);\n  return resolvedSlug ? `/cardapio/${resolvedSlug}` : '/';\n}\n'''
if s == old:
    helper.write_text(new)
elif s != new:
    raise SystemExit('kiosk helper guard failed: unexpected content')

admin=Path('src/pages/Admin.tsx')
a=admin.read_text()
legacy="href={`/loja/${activeSlug}`}"
canonical="href={getKioskHomePath(activeSlug)}"
if a.count(canonical) == 1 and a.count(legacy) == 0:
    pass
elif a.count(legacy) == 1 and a.count(canonical) == 0:
    admin.write_text(a.replace(legacy, canonical, 1))
else:
    raise SystemExit(f'admin open-store guard failed: legacy={a.count(legacy)}, canonical={a.count(canonical)}')
print('canonical open-store route patch applied')
