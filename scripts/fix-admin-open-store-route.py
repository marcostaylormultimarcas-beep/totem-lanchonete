from pathlib import Path
p=Path('src/pages/Admin.tsx')
s=p.read_text()
old='''              href={`/loja/${activeSlug}`}'''
new='''              href={getKioskHomePath(activeSlug)}'''
if s.count(old)!=1: raise SystemExit(f'open store route guard failed: {s.count(old)}')
s=s.replace(old,new,1)
p.write_text(s)
print('canonical open store route patch applied')
