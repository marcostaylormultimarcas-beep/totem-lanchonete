import { useState, useEffect } from 'react';
import { ArrowLeft, Copy, Check, MessageCircle, CheckCircle2, Ticket, Banknote, QrCode, CreditCard, Globe, Loader2, FileText } from 'lucide-react';
import { CartItem, getItemTotal, formatCurrency, StoreSettings } from '@/data/store';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';
import { isDemoMode } from '@/lib/demoMode';
import type { AppliedCoupon } from './CartScreen';

interface PaymentScreenProps {
  cart: CartItem[];
  customerName: string;
  customerPhone: string;
  customerCpf?: string;
  orderType: 'local' | 'viagem';
  deliveryAddress?: string;
  deliveryReference?: string;
  deliveryRecipient?: string;
  bairroId?: string;
  bairroNome?: string;
  deliveryFee?: number;
  bairroTempo?: number;
  appliedCoupon?: AppliedCoupon | null;
  onBack: () => void;
  onDone: (orderId?: string) => void;
}

const FALLBACK_PIX_KEY = 'pagamento@visionmidia.com';
const FALLBACK_QR_URL = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=PagamentoVisionMidia';

const PaymentScreen = ({ cart, customerName, customerPhone, customerCpf, orderType, deliveryAddress, deliveryReference, deliveryRecipient, bairroId, bairroNome, deliveryFee = 0, bairroTempo, appliedCoupon, onBack, onDone }: PaymentScreenProps) => {
  const orgId = useOrgId();
  type Method = 'pix' | 'cash' | 'terminal' | 'online';
  const [method, setMethod] = useState<Method | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [generatedNumber, setGeneratedNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [storeSettings, setStoreSettings] = useState<{
    storeName: string; whatsappNumber: string; pixKeyManual: string; mpEnabled: boolean;
    payCash: boolean; payPix: boolean; payTerminal: boolean; payOnline: boolean; terminalId: string;
  }>({ storeName: 'Vision Mídia', whatsappNumber: '', pixKeyManual: '', mpEnabled: false, payCash: true, payPix: true, payTerminal: false, payOnline: false, terminalId: '' });
  const [mpPix, setMpPix] = useState<{ qr_code_base64: string; qr_code: string } | null>(null);
  const [mpLoading, setMpLoading] = useState(false);
  // Online card form (placeholder; integração futura)
  const [card, setCard] = useState({ number: '', holder: '', expiry: '', cvv: '' });
  const subtotal = cart.reduce((sum, item) => sum + getItemTotal(item), 0);
  const discount = appliedCoupon ? Math.min(appliedCoupon.discount, subtotal) : 0;
  const total = Math.max(0, subtotal - discount);

  const pixKey = storeSettings.pixKeyManual || mpPix?.qr_code || FALLBACK_PIX_KEY;
  const qrImageSrc = mpPix?.qr_code_base64
    ? `data:image/png;base64,${mpPix.qr_code_base64}`
    : FALLBACK_QR_URL;

  useEffect(() => {
    if (!orgId) return;
    const fetchSettings = async () => {
      const { data } = await supabase.from('settings').select('store_name, whatsapp_number, pix_key_manual, mp_access_token, pay_cash_enabled, pay_pix_enabled, pay_card_terminal_enabled, pay_card_online_enabled, mp_terminal_id').eq('organization_id', orgId).maybeSingle();
      if (data) {
        setStoreSettings({
          storeName: data.store_name || 'Vision Mídia',
          whatsappNumber: data.whatsapp_number || '',
          pixKeyManual: (data as any).pix_key_manual || '',
          mpEnabled: Boolean((data as any).mp_access_token),
          payCash: (data as any).pay_cash_enabled !== false,
          payPix: (data as any).pay_pix_enabled !== false,
          payTerminal: Boolean((data as any).pay_card_terminal_enabled),
          payOnline: Boolean((data as any).pay_card_online_enabled),
          terminalId: (data as any).mp_terminal_id || '',
        });
      }
    };
    fetchSettings();
  }, [orgId]);

  // Auto-gera Pix real via Mercado Pago quando configurado e fora do modo demo
  useEffect(() => {
    if (method !== 'pix') return;
    if (!orgId || !storeSettings.mpEnabled || mpPix || mpLoading || isDemoMode() || total <= 0) return;
    setMpLoading(true);
    supabase.functions.invoke('mercadopago-create-pix', {
      body: { organization_id: orgId, amount: total, description: `Pedido ${storeSettings.storeName}` },
    }).then(({ data, error }) => {
      if (error || !data?.ok) {
        console.warn('Mercado Pago Pix indisponível:', error || data);
      } else {
        setMpPix({ qr_code_base64: data.qr_code_base64, qr_code: data.qr_code });
      }
    }).finally(() => setMpLoading(false));
  }, [orgId, storeSettings.mpEnabled, total, mpPix, mpLoading, storeSettings.storeName, method]);



  const handleCopy = () => {
    navigator.clipboard.writeText(pixKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buildWhatsAppMessage = () => {
    let msg = `🧾 *NOVO PEDIDO - ${storeSettings.storeName}*\n\n`;
    msg += `🔢 *SENHA DO PEDIDO: #${generatedNumber}*\n\n`;
    msg += `👤 *CLIENTE:* ${customerName} - ${customerPhone}\n`;
    msg += `📍 *LOCAL:* ${orderType === 'local' ? 'Comer no Local (Mesa)' : 'Para Viagem (Entrega)'}\n`;
    if (orderType === 'viagem' && deliveryAddress) {
      msg += `🏠 *ENDEREÇO:* ${deliveryAddress}\n`;
      if (deliveryReference) msg += `📌 *REFERÊNCIA:* ${deliveryReference}\n`;
      if (deliveryRecipient) msg += `👤 *RECEBEDOR:* ${deliveryRecipient}\n`;
    }
    msg += `\n📋 *PEDIDO:*\n─────────────────\n`;
    cart.forEach((item, i) => {
      msg += `${i + 1}. ${item.quantity}x ${item.product.name} — ${formatCurrency(getItemTotal(item))}\n`;
      if (item.removedIngredients.length > 0) msg += `   ❌ Sem: ${item.removedIngredients.join(', ')}\n`;
      if (item.selectedExtras.length > 0) msg += `   ✅ Extras: ${item.selectedExtras.map(e => `${e.name} (+${formatCurrency(e.price)})`).join(', ')}\n`;
    });
    msg += `─────────────────\n`;
    if (appliedCoupon && discount > 0) {
      msg += `🏷️ *CUPOM:* ${appliedCoupon.codigo} (- ${formatCurrency(discount)})\n`;
    }
    const methodLabel = method === 'cash' ? 'Dinheiro no balcão' : method === 'terminal' ? 'Cartão na maquininha' : method === 'online' ? 'Cartão online' : 'Pix';
    msg += `💳 *PAGAMENTO:* ${methodLabel} - Aguardando Conferência\n💰 *TOTAL: ${formatCurrency(total)}*`;
    return encodeURIComponent(msg);
  };

  const handleSendToKitchen = () => {
    const whatsappUrl = `https://wa.me/${storeSettings.whatsappNumber}?text=${buildWhatsAppMessage()}`;
    window.open(whatsappUrl, '_blank');
    onDone();
  };

  const handleConfirmPayment = async () => {
    setSaving(true);

    try {
      // === MODO DEMO ===
      // Simulador da Landing Page: não grava no banco, não notifica KDS.
      if (isDemoMode()) {
        const num = Math.floor(Math.random() * 900 + 100).toString();
        setGeneratedNumber(num);
        await new Promise((r) => setTimeout(r, 600));
        setConfirmed(true);
        setSaving(false);
        return;
      }

      // Get next order number from DB count
      const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('organization_id', orgId);
      const num = ((count || 0) + 1).toString().padStart(3, '0');
      setGeneratedNumber(num);

      const orderItems = cart.map(item => ({
        product_id: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        price: item.product.price,
        total: getItemTotal(item),
        removedIngredients: item.removedIngredients,
        extras: item.selectedExtras.map(e => e.name),
      }));

      // Get current user if logged in
      const { data: { session } } = await supabase.auth.getSession();

      const { data, error } = await supabase.from('orders').insert({
        organization_id: orgId,
        order_number: num,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_cpf: customerCpf || '',
        order_type: orderType,
        delivery_address: deliveryAddress || '',
        delivery_reference: deliveryReference || '',
        delivery_recipient: deliveryRecipient || '',
        items: orderItems,
        total,
        status: 'pending',
        payment_method: method || '',
        user_id: session?.user?.id || null,
      }).select('id').single();

      if (error) throw error;

      // Vincula nota fiscal ao pedido quando CPF informado
      if (data?.id && customerCpf) {
        const nfeUrl = `${window.location.origin}/fiscal/${data.id}`;
        await supabase.from('orders').update({
          nfe_url: nfeUrl,
          nfe_status: 'issued',
          nfe_numero: `NFE-${data.id.replace(/-/g, '').slice(0, 16).toUpperCase()}`,
        }).eq('id', data.id);

        // Impressão automática no totem (após confirmação de pagamento)
        setTimeout(() => {
          try { window.open(nfeUrl, '_blank', 'noopener'); } catch {}
        }, 800);
      }

      setConfirmed(true);
      if (data) setCurrentOrderId(data.id);
    } catch (err) {
      console.error('Error saving order:', err);
      setConfirmed(true);
    } finally {
      setSaving(false);
    }
  };

  if (confirmed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-6 max-w-md mx-auto">
        <div className="w-20 h-20 rounded-full bg-success/20 flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-success" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold text-success">Pagamento Confirmado!</h2>
          <div className="flex items-center justify-center gap-2 mt-3">
            <Ticket className="w-8 h-8 text-primary" />
            <span className="text-4xl font-black text-primary">#{generatedNumber}</span>
          </div>
          <p className="text-muted-foreground text-sm">Guarde sua senha para retirar o pedido</p>
        </div>

        <div className="w-full kiosk-card p-4 space-y-3">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">👤 Cliente</p>
            <p className="font-bold">{customerName} — {customerPhone}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">📍 Local</p>
            <p className="font-bold">{orderType === 'local' ? 'Comer no Local' : 'Para Viagem'}</p>
          </div>
          {orderType === 'viagem' && deliveryAddress && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">🏠 Endereço</p>
              <p className="font-bold text-sm">{deliveryAddress}</p>
            </div>
          )}
          <hr className="border-border" />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">📋 Pedido</p>
            {cart.map((item, i) => (
              <div key={item.id} className="text-sm space-y-0.5">
                <p className="font-semibold">{i + 1}. {item.quantity}x {item.product.name} — {formatCurrency(getItemTotal(item))}</p>
                {item.removedIngredients.length > 0 && <p className="text-destructive text-xs">❌ Sem: {item.removedIngredients.join(', ')}</p>}
                {item.selectedExtras.length > 0 && <p className="text-success text-xs">✅ Extras: {item.selectedExtras.map(e => e.name).join(', ')}</p>}
              </div>
            ))}
          </div>
          <hr className="border-border" />
          {discount > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-success">Cupom {appliedCoupon?.codigo}</span>
                <span className="text-success font-semibold">- {formatCurrency(discount)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-center">
            <span className="font-bold text-lg">TOTAL</span>
            <span className="font-black text-xl text-primary">{formatCurrency(total)}</span>
          </div>
        </div>

        <button onClick={handleSendToKitchen} className="touch-btn w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3">
          <MessageCircle className="w-7 h-7" /> ENVIAR PEDIDO PARA A COZINHA
        </button>

        {currentOrderId && customerCpf && (
          <a
            href={`/fiscal/${currentOrderId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="touch-btn w-full bg-orange-600 hover:bg-orange-500 text-white py-4 rounded-xl text-lg flex items-center justify-center gap-2 font-bold"
          >
            <FileText className="w-6 h-6" /> Baixar Nota Fiscal
          </a>
        )}


        {currentOrderId && (
          <button onClick={() => onDone(currentOrderId)} className="touch-btn w-full bg-muted text-foreground py-4 rounded-xl text-lg flex items-center justify-center gap-2">
            📍 Acompanhar Pedido
          </button>
        )}

        <button onClick={() => onDone()} className="touch-btn w-full bg-primary/10 border-2 border-primary text-primary py-4 rounded-xl text-lg flex items-center justify-center gap-2">
          🏠 Voltar ao Menu Inicial
        </button>
      </div>
    );
  }

  // Construct the list of allowed methods from store settings
  const availableMethods: { key: Method; label: string; desc: string; icon: JSX.Element }[] = [
    storeSettings.payPix && { key: 'pix' as Method, label: 'Pix (QR Code)', desc: 'Pague pelo app do seu banco', icon: <QrCode className="w-6 h-6" /> },
    storeSettings.payCash && { key: 'cash' as Method, label: 'Dinheiro no Balcão', desc: 'Pagar ao retirar o pedido', icon: <Banknote className="w-6 h-6" /> },
    storeSettings.payTerminal && { key: 'terminal' as Method, label: 'Cartão na Maquininha', desc: 'Passe o cartão na maquininha ao lado', icon: <CreditCard className="w-6 h-6" /> },
    storeSettings.payOnline && { key: 'online' as Method, label: 'Cartão Online', desc: 'Pagar com cartão pelo celular', icon: <Globe className="w-6 h-6" /> },
  ].filter(Boolean) as any;

  // Auto-select if only one method enabled
  useEffect(() => {
    if (!method && availableMethods.length === 1) setMethod(availableMethods[0].key);
  }, [method, availableMethods]);

  const Header = ({ title }: { title: React.ReactNode }) => (
    <div className="flex items-center gap-4 p-4 border-b border-border">
      <button onClick={() => (method ? setMethod(null) : onBack())} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-7 h-7" /></button>
      <h2 className="text-xl font-bold">{title}</h2>
    </div>
  );

  // === Method picker ===
  if (!method) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header title={<>Forma de <span className="text-primary">Pagamento</span></>} />
        <div className="flex-1 flex flex-col px-6 py-6 gap-3 max-w-md mx-auto w-full">
          <div className="text-center mb-2">
            <p className="text-sm text-muted-foreground">Total a pagar</p>
            <p className="text-3xl font-black text-primary">{formatCurrency(total)}</p>
          </div>
          {availableMethods.length === 0 ? (
            <div className="kiosk-card p-6 text-center space-y-2">
              <p className="font-bold">Nenhuma forma de pagamento ativa</p>
              <p className="text-xs text-muted-foreground">Peça ao lojista para habilitar pelo menos uma opção de pagamento nas configurações.</p>
            </div>
          ) : availableMethods.map(m => (
            <button key={m.key} onClick={() => setMethod(m.key)} className="touch-btn w-full kiosk-card p-4 flex items-center gap-4 text-left hover:border-primary border-2 border-transparent transition-colors">
              <div className="w-12 h-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">{m.icon}</div>
              <div className="flex-1">
                <p className="font-bold">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // === Cash ===
  if (method === 'cash') {
    return (
      <div className="min-h-screen flex flex-col">
        <Header title={<>Pagamento <span className="text-primary">Dinheiro</span></>} />
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center"><Banknote className="w-12 h-12 text-primary" /></div>
          <div className="text-center space-y-2">
            <h3 className="text-2xl font-bold">Pague no Balcão</h3>
            <p className="text-sm text-muted-foreground">Apresente a senha do pedido no caixa e efetue o pagamento em dinheiro ao retirar.</p>
          </div>
          <div className="text-center"><p className="text-2xl font-black text-primary">{formatCurrency(total)}</p></div>
          <button onClick={handleConfirmPayment} disabled={saving} className="touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">
            <Check className="w-6 h-6" /> {saving ? 'Salvando...' : 'Confirmar Pedido'}
          </button>
        </div>
      </div>
    );
  }

  // === Terminal (maquininha física) ===
  if (method === 'terminal') {
    return (
      <div className="min-h-screen flex flex-col">
        <Header title={<>Cartão na <span className="text-primary">Maquininha</span></>} />
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center animate-pulse"><CreditCard className="w-12 h-12 text-primary" /></div>
          <div className="text-center space-y-2">
            <h3 className="text-2xl font-bold">Siga as instruções na maquininha ao lado</h3>
            <p className="text-sm text-muted-foreground">Insira ou aproxime seu cartão na maquininha posicionada ao lado do totem para concluir o pagamento de <b>{formatCurrency(total)}</b>.</p>
            {storeSettings.terminalId && (
              <p className="text-[11px] text-muted-foreground/80 font-mono">Terminal: {storeSettings.terminalId}</p>
            )}
          </div>
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <button onClick={handleConfirmPayment} disabled={saving} className="touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">
            <Check className="w-6 h-6" /> {saving ? 'Salvando...' : 'Pagamento Aprovado na Maquininha'}
          </button>
        </div>
      </div>
    );
  }

  // === Online card form (preparado para gateway) ===
  if (method === 'online') {
    const canSubmit = card.number.replace(/\s/g, '').length >= 13 && card.holder.trim().length > 2 && /^\d{2}\/\d{2}$/.test(card.expiry) && card.cvv.length >= 3;
    return (
      <div className="min-h-screen flex flex-col">
        <Header title={<>Cartão <span className="text-primary">Online</span></>} />
        <div className="flex-1 flex flex-col px-6 py-6 gap-4 max-w-md mx-auto w-full">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-3xl font-black text-primary">{formatCurrency(total)}</p>
          </div>
          <div className="kiosk-card p-4 space-y-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">Número do cartão</span>
              <input inputMode="numeric" maxLength={19} placeholder="0000 0000 0000 0000" value={card.number}
                onChange={e => setCard({ ...card, number: e.target.value.replace(/[^\d ]/g, '') })}
                className="w-full mt-1 px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm font-mono" />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Nome impresso no cartão</span>
              <input maxLength={60} placeholder="NOME COMPLETO" value={card.holder}
                onChange={e => setCard({ ...card, holder: e.target.value.toUpperCase() })}
                className="w-full mt-1 px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm font-mono" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-muted-foreground">Validade</span>
                <input inputMode="numeric" maxLength={5} placeholder="MM/AA" value={card.expiry}
                  onChange={e => {
                    let v = e.target.value.replace(/\D/g, '').slice(0, 4);
                    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
                    setCard({ ...card, expiry: v });
                  }}
                  className="w-full mt-1 px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm font-mono" />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">CVV</span>
                <input inputMode="numeric" maxLength={4} placeholder="123" value={card.cvv}
                  onChange={e => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '') })}
                  className="w-full mt-1 px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm font-mono" />
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">🔒 Em breve: cobrança real via gateway. Por enquanto o pedido é enviado e o lojista confirma o pagamento manualmente.</p>
          </div>
          <button onClick={handleConfirmPayment} disabled={saving || !canSubmit} className="touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">
            <Check className="w-6 h-6" /> {saving ? 'Processando...' : `Pagar ${formatCurrency(total)}`}
          </button>
        </div>
      </div>
    );
  }

  // === Pix (default original flow) ===
  return (
    <div className="min-h-screen flex flex-col">
      <Header title={<>Pagamento <span className="text-primary">PIX</span></>} />
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 max-w-md mx-auto">
        <p className="text-muted-foreground text-sm">
          {mpLoading ? 'Gerando QR Code Pix...' : 'Escaneie o QR Code ou copie a chave'}
        </p>
        <div className="bg-foreground rounded-2xl p-4">
          <img src={qrImageSrc} alt="QR Code PIX" width={250} height={250} className="rounded-lg" />
        </div>
        {storeSettings.pixKeyManual && (
          <div className="w-full text-center">
            <p className="text-xs text-muted-foreground mb-1">Chave Pix:</p>
            <p className="font-mono text-sm bg-muted/50 px-3 py-2 rounded-lg break-all">{storeSettings.pixKeyManual}</p>
          </div>
        )}
        <div className="w-full">
          <p className="text-sm text-muted-foreground text-center mb-2">
            {mpPix ? 'Pix copia e cola:' : 'Chave PIX (copia e cola):'}
          </p>
          <button onClick={handleCopy} className="w-full flex items-center justify-center gap-2 bg-muted px-4 py-3 rounded-xl transition-all active:scale-95">
            {copied ? <Check className="w-5 h-5 text-success" /> : <Copy className="w-5 h-5 text-muted-foreground" />}
            <span className="font-mono text-xs break-all line-clamp-2">{pixKey}</span>
          </button>
        </div>

        <div className="text-center"><p className="text-2xl font-black text-primary">{formatCurrency(total)}</p></div>
        <button onClick={handleConfirmPayment} disabled={saving} className="touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">
          <Check className="w-6 h-6" /> {saving ? 'Salvando...' : 'Já Realizei o Pagamento'}
        </button>
      </div>
    </div>
  );
};

export default PaymentScreen;
