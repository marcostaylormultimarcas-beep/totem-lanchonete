from pathlib import Path
p=Path('src/components/kiosk/CartScreen.tsx')
s=p.read_text()
def r(a,b):
 global s
 if s.count(a)!=1: raise SystemExit(f'guard failed {s.count(a)}: {a[:60]}')
 s=s.replace(a,b,1)
r("import { useEffect, useMemo, useState } from 'react';", "import { useEffect, useState } from 'react';")
r('  useMemo(() => {\n    if (storeStatus.nextOpenAt && !scheduledDate) {','  useEffect(() => {\n    if (storeStatus.nextOpenAt && !scheduledDate) {')
r('    <div className="min-h-screen flex flex-col pb-40 max-w-[1200px] mx-auto">','    <div className={`min-h-screen flex flex-col max-w-[1200px] mx-auto ${scheduleMode ? \'pb-[34rem]\' : \'pb-72\'}`}>')
r('<div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4 space-y-2">','<div className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border p-4 space-y-2 max-h-[72dvh] overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">')
r('<div className="flex gap-2">\n                      <input type="date"','<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">\n                      <input type="date"')
p.write_text(s)
