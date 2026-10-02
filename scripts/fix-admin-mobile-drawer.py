from pathlib import Path
p=Path('src/pages/Admin.tsx')
s=p.read_text()
old='''            <Sheet>\n              <SheetTrigger asChild>'''
new='''            <Sheet>\n              <SheetTrigger asChild>'''
# Use Radix SheetClose around each drawer navigation item. This avoids adding global state to huge Admin.tsx.
if s.count(old)!=1: raise SystemExit(f'Sheet guard failed: {s.count(old)}')
old_import="import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';"
new_import="import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';"
if s.count(old_import)!=1: raise SystemExit(f'import guard failed: {s.count(old_import)}')
s=s.replace(old_import,new_import,1)
old_button='''                    return (\n                      <button\n                        key={t.key}\n                        onClick={() => setTab(t.key)}\n                        className={`w-full text-left px-4 py-3 rounded-xl text-sm flex items-center gap-3 border transition-colors ${\n                          active\n                            ? 'bg-[#FF7A00]/10 text-[#FF7A00] border-[#FF7A00]/40'\n                            : 'bg-white/[0.03] text-zinc-300 border-white/[0.06] hover:border-white/15 hover:text-white'\n                        }`}\n                      >\n                        {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}\n                        <span className="truncate font-medium">{t.label}</span>\n                      </button>\n                    );'''
new_button='''                    return (\n                      <SheetClose asChild key={t.key}>\n                        <button\n                          onClick={() => setTab(t.key)}\n                          className={`w-full text-left px-4 py-3 rounded-xl text-sm flex items-center gap-3 border transition-colors ${\n                            active\n                              ? 'bg-[#FF7A00]/10 text-[#FF7A00] border-[#FF7A00]/40'\n                              : 'bg-white/[0.03] text-zinc-300 border-white/[0.06] hover:border-white/15 hover:text-white'\n                          }`}\n                        >\n                          {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}\n                          <span className="truncate font-medium">{t.label}</span>\n                        </button>\n                      </SheetClose>\n                    );'''
if s.count(old_button)!=1: raise SystemExit(f'drawer button guard failed: {s.count(old_button)}')
s=s.replace(old_button,new_button,1)
p.write_text(s)
print('admin drawer close patch applied')
