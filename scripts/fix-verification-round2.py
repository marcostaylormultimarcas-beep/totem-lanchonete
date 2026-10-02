from pathlib import Path

# Guarded source transformations only. Fail instead of guessing if source changed.
def replace_once(path, old, new):
    p=Path(path); s=p.read_text()
    if s.count(old)!=1:
        raise SystemExit(f'{path}: expected 1 match, got {s.count(old)} for {old[:80]!r}')
    p.write_text(s.replace(old,new,1))

# Cart: state mutation belongs in effect; fixed checkout footer must reserve dynamic space.
p='src/components/kiosk/CartScreen.tsx'
replace_once(p, "import { useEffect, useMemo, useState } from 'react';", "import { useEffect, useState } from 'react';")
replace_once(p, '  useMemo(() => {\n    if (storeStatus.nextOpenAt && !scheduledDate) {', '  useEffect(() => {\n    if (storeStatus.nextOpenAt && !scheduledDate) {')
replace_once(p, '    <div className="min-h-screen flex flex-col pb-40 max-w-[1200px] mx-auto">', '    <div className={`min-h-screen flex flex-col max-w-[1200px] mx-auto ${scheduleMode ? \'pb-[34rem]\' : \'pb-72\'}`}>')
replace_once(p, '<div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4 space-y-2">', '<div className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border p-4 space-y-2 max-h-[72dvh] overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">')
replace_once(p, '<div className="flex gap-2">\n                      <input type="date"', '<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">\n                      <input type="date"')

print('round2 guarded fixes applied')
