from pathlib import Path
p=Path('src/components/kiosk/PaymentScreen.tsx')
s=p.read_text()
for old in ["const FALLBACK_PIX_KEY = 'pagamento@visionmidia.com';\n", "const FALLBACK_QR_URL = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=PagamentoVisionMidia';\n"]:
    if s.count(old)!=1: raise SystemExit(f'fallback constant guard failed: {old[:25]} count={s.count(old)}')
    s=s.replace(old,'',1)
old="""  const pixKey = storeSettings.pixKeyManual || mpPix?.qr_code || FALLBACK_PIX_KEY;
  const qrImageSrc = mpPix?.qr_code_base64
    ? `data:image/png;base64,${mpPix.qr_code_base64}`
    : FALLBACK_QR_URL;"""
new="""  const pixKey = mpPix?.qr_code || storeSettings.pixKeyManual || '';
  const qrImageSrc = mpPix?.qr_code_base64 ? `data:image/png;base64,${mpPix.qr_code_base64}` : '';
  const pixConfigured = Boolean(storeSettings.pixKeyManual || storeSettings.mpEnabled);"""
if s.count(old)!=1: raise SystemExit(f'pix derivation guard failed: {s.count(old)}')
s=s.replace(old,new,1)
old="""    storeSettings.payPix && { key: 'pix' as Method, label: 'Pix (QR Code)', desc: 'Pague pelo app do seu banco', icon: <QrCode className=\"w-6 h-6\" /> },"""
new="""    storeSettings.payPix && pixConfigured && { key: 'pix' as Method, label: 'Pix (QR Code)', desc: 'Pague pelo app do seu banco', icon: <QrCode className=\"w-6 h-6\" /> },"""
if s.count(old)!=1: raise SystemExit(f'method guard failed: {s.count(old)}')
s=s.replace(old,new,1)
old="""        <div className=\"bg-foreground rounded-2xl p-4\">
          <img src={qrImageSrc} alt=\"QR Code PIX\" width={250} height={250} className=\"rounded-lg\" />
        </div>"""
new="""        {qrImageSrc ? (
          <div className=\"bg-foreground rounded-2xl p-4\">
            <img src={qrImageSrc} alt=\"QR Code PIX\" width={250} height={250} className=\"rounded-lg\" />
          </div>
        ) : storeSettings.mpEnabled && mpLoading ? (
          <Loader2 className=\"w-10 h-10 text-primary animate-spin\" />
        ) : storeSettings.pixKeyManual ? (
          <div className=\"w-full kiosk-card p-4 text-center text-sm text-muted-foreground\">Use a chave Pix configurada abaixo.</div>
        ) : (
          <div role=\"alert\" className=\"w-full rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive\">Pix indisponível no momento. Volte e escolha outra forma de pagamento.</div>
        )}"""
if s.count(old)!=1: raise SystemExit(f'qr block guard failed: {s.count(old)}')
s=s.replace(old,new,1)
old="""        <div className=\"w-full\">
          <p className=\"text-sm text-muted-foreground text-center mb-2\">
            {mpPix ? 'Pix copia e cola:' : 'Chave PIX (copia e cola):'}
          </p>
          <button onClick={handleCopy} className=\"w-full flex items-center justify-center gap-2 bg-muted px-4 py-3 rounded-xl transition-all active:scale-95\">
            {copied ? <Check className=\"w-5 h-5 text-success\" /> : <Copy className=\"w-5 h-5 text-muted-foreground\" />}
            <span className=\"font-mono text-xs break-all line-clamp-2\">{pixKey}</span>
          </button>
        </div>"""
new="""        {pixKey && (
          <div className=\"w-full\">
            <p className=\"text-sm text-muted-foreground text-center mb-2\">
              {mpPix ? 'Pix copia e cola:' : 'Chave PIX (copia e cola):'}
            </p>
            <button onClick={handleCopy} className=\"w-full flex items-center justify-center gap-2 bg-muted px-4 py-3 rounded-xl transition-all active:scale-95\">
              {copied ? <Check className=\"w-5 h-5 text-success\" /> : <Copy className=\"w-5 h-5 text-muted-foreground\" />}
              <span className=\"font-mono text-xs break-all line-clamp-2\">{pixKey}</span>
            </button>
          </div>
        )}"""
if s.count(old)!=1: raise SystemExit(f'copy block guard failed: {s.count(old)}')
s=s.replace(old,new,1)
old="""        <button onClick={handleConfirmPayment} disabled={saving} className=\"touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50\">"""
# Three occurrences (cash, terminal, pix): target last one only.
if s.count(old)<1: raise SystemExit('confirm button guard failed')
pos=s.rfind(old)
new="""        <button onClick={handleConfirmPayment} disabled={saving || (!pixKey && !mpLoading)} className=\"touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50\">"""
s=s[:pos]+s[pos:].replace(old,new,1)
p.write_text(s)
print('unsafe Pix fallback removed')
