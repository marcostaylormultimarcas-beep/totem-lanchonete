from pathlib import Path

def patch(path, old, new, count=1):
 p=Path(path); s=p.read_text()
 if s.count(old)!=count: raise SystemExit(f'{path}: guard expected {count}, got {s.count(old)}: {old[:70]!r}')
 p.write_text(s.replace(old,new,count))

p='src/components/kiosk/PaymentScreen.tsx'
patch(p, "import { useState, useEffect } from 'react';", "import { useState, useEffect } from 'react';\nimport { toast } from 'sonner';")
patch(p, "  const [saving, setSaving] = useState(false);", "  const [saving, setSaving] = useState(false);\n  const [paymentError, setPaymentError] = useState('');")
patch(p, "  const handleConfirmPayment = async () => {\n    setSaving(true);", "  const handleConfirmPayment = async () => {\n    if (saving) return;\n    setPaymentError('');\n    setSaving(true);")
patch(p, "    } catch (err) {\n      console.error('Error saving order:', err);\n      setConfirmed(true);", "    } catch (err: any) {\n      console.error('Error saving order:', err);\n      const message = err?.message || 'Não foi possível registrar o pedido. Tente novamente.';\n      setPaymentError(message);\n      toast.error('Pedido não confirmado', { description: message });\n      setConfirmed(false);")
# All three manual confirmation flows use the same button text. Insert the banner
# directly before each occurrence, preserving the existing indentation.
needle='<button onClick={handleConfirmPayment} disabled={saving} className="touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">'
s=Path(p).read_text()
if s.count(needle)!=3: raise SystemExit(f'{p}: expected 3 payment confirmation buttons, got {s.count(needle)}')
lines=s.splitlines(True); out=[]; inserted=0
for line in lines:
 if needle in line:
  indent=line[:len(line)-len(line.lstrip())]
  out.append(indent+'{paymentError && (\n')
  out.append(indent+'  <div role="alert" className="w-full rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{paymentError}</div>\n')
  out.append(indent+')}\n')
  inserted+=1
 out.append(line)
if inserted!=3: raise SystemExit(f'{p}: inserted {inserted} payment error banners')
Path(p).write_text(''.join(out))

p='src/components/admin/VisionPrimePanel.tsx'
patch(p, "  const [subscribers, setSubscribers] = useState<number>(0);", "  const [subscribers, setSubscribers] = useState<number>(0);\n  const [numeric, setNumeric] = useState({ mensalidade: '', desconto: '', frete: '' });")
patch(p, "      setCfg(row ? { ...DEFAULT, ...(row as any) } : DEFAULT);\n      setSubscribers(count || 0);", "      const next = row ? { ...DEFAULT, ...(row as any) } : DEFAULT;\n      setCfg(next);\n      setNumeric({ mensalidade: String(next.valor_mensalidade), desconto: String(next.desconto_percentual), frete: String(next.frete_gratis_minimo) });\n      setSubscribers(count || 0);")
patch(p, "    const payload = { organization_id: organizationId, ...cfg };", "    const parsed = {\n      valor_mensalidade: Math.max(0, Number(numeric.mensalidade || 0)),\n      desconto_percentual: Math.min(100, Math.max(0, Number(numeric.desconto || 0))),\n      frete_gratis_minimo: Math.max(0, Number(numeric.frete || 0)),\n    };\n    const payload = { organization_id: organizationId, ...cfg, ...parsed };")
patch(p, "value={cfg.valor_mensalidade}\n              onChange={e => setCfg({ ...cfg, valor_mensalidade: Number(e.target.value) || 0 })}", "value={numeric.mensalidade}\n              onChange={e => setNumeric({ ...numeric, mensalidade: e.target.value })}")
patch(p, "value={cfg.desconto_percentual}\n              onChange={e => setCfg({ ...cfg, desconto_percentual: Number(e.target.value) || 0 })}", "value={numeric.desconto}\n              onChange={e => setNumeric({ ...numeric, desconto: e.target.value })}")
patch(p, "value={cfg.frete_gratis_minimo}\n              onChange={e => setCfg({ ...cfg, frete_gratis_minimo: Number(e.target.value) || 0 })}", "value={numeric.frete}\n              onChange={e => setNumeric({ ...numeric, frete: e.target.value })}")

print('round3 guarded fixes applied')
