from pathlib import Path
p=Path('src/pages/PDV.tsx')
s=p.read_text(encoding='utf-8')
# This guarded migration intentionally refuses to edit unless the secure PIX intent flow is already present.
if 'pdvRpc.createPixIntent(' not in s: raise SystemExit('guard failed: secure PIX intent flow missing')
if 'intent_id: intent.intent_id' not in s: raise SystemExit('guard failed: secure edge function contract missing')
# Capture intent id in PIX state so payment status can be checked.
old='''        setPixData({
          qrBase64: d.qr_code_base64 || "",
          copiaECola: d.qr_code || "",
          amount: Number(d.amount ?? intent.amount) || 0,
        });'''
new='''        setPixData({
          qrBase64: d.qr_code_base64 || "",
          copiaECola: d.qr_code || "",
          amount: Number(d.amount ?? intent.amount) || 0,
          intentId: String(d.intent_id || intent.intent_id),
        });'''
if s.count(old)!=1: raise SystemExit(f'pix state guard failed: {s.count(old)}')
s=s.replace(old,new,1)
# Extend the local state type, exact known declaration.
oldtype='''  const [pixData, setPixData] = useState<{ qrBase64: string; copiaECola: string; amount: number } | null>(null);'''
newtype='''  const [pixData, setPixData] = useState<{ qrBase64: string; copiaECola: string; amount: number; intentId: string } | null>(null);'''
if s.count(oldtype)!=1: raise SystemExit(f'pix type guard failed: {s.count(oldtype)}')
s=s.replace(oldtype,newtype,1)
# Block sale finalization unless the server confirms this exact intent as paid/approved.
needle='''  const finalizar = async () => {'''
if s.count(needle)!=1: raise SystemExit(f'finalizar guard failed: {s.count(needle)}')
replacement='''  const finalizar = async () => {
    if (forma === "pix") {
      if (!pixData?.intentId) return toast.error("Gere o PIX antes de finalizar");
      const { data: pixStatusData, error: pixStatusError } = await pdvRpc.pixStatus(sessionToken, pixData.intentId);
      const pixStatus = pixStatusData as any;
      if (pixStatusError || !pixStatus?.ok || !["paid", "approved"].includes(String(pixStatus.status || "").toLowerCase())) {
        return toast.error("Pagamento PIX ainda não confirmado");
      }
    }'''
s=s.replace(needle,replacement,1)
if 'pdvRpc.pixStatus(sessionToken, pixData.intentId)' not in s: raise SystemExit('invariant failed: server PIX confirmation missing')
p.write_text(s,encoding='utf-8')
print('PIX payment confirmation guard applied')
