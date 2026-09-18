import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Check, MessageCircle, CheckCircle2, Ticket, Banknote, QrCode, CreditCard, Globe, Loader2 } from 'lucide-react';
import { CartItem, getItemTotal, formatCurrency, StoreSettings } from '@/data/store';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';
import { isDemoMode } from '@/lib/demoMode';
import type { AppliedCoupon } from './CartScreen';
import { useVisionPrimeConfig, useVisionPrimeStatus } from '@/hooks/useVisionPrime';
import { Crown } from 'lucide-react';

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
  deliveryCep?: string;
  appliedCoupon?: AppliedCoupon | null;
  scheduledFor?: string | null;
  onBack: () => void;
  onDone: (orderId?: string) => void;
}


const PaymentScreen = ({ cart, customerName, customerPhone, customerCpf, orderType, deliveryAddress, deliveryReference, deliveryRecipient, bairroId, bairroNome, deliveryFee = 0, bairroTempo, deliveryCep, appliedCoupon, scheduledFor, onBack, onDone }: PaymentScreenProps) => {
  const orgId = useOrgId();
  type Method = 'pix' | 'cash' | 'terminal' | 'online';
  const [method, setMethod] = useState<Method | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [generatedNumber, setGeneratedNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [partnerGift, setPartnerGift] = useState<{ codigo: string; discount_percent: number; partner_name: string; partner_slug: string } | null>(null);
  const [copiedPartner, setCopiedPartner] = useState(false);
  const [storeSettings, setStoreSettings] = useState<{
    storeName: string; whatsappNumber: string; pixKeyManual: string; mpEnabled: boolean;
    payCash: boolean; payPix: boolean; payTerminal: boolean; payOnline: boolean; terminalId: string;
  }>({ storeName: 'Vision Mídia', whatsappNumber: '', pixKeyManual: '', mpEnabled: false, payCash: true, payPix: true, payTerminal: false, payOnline: false, terminalId: '' });
  const [mpPix, setMpPix] = useState<{ qr_code_base64: string; qr_code: string } | null>(null);
  const [mpLoading, setMpLoading] = useState(false);
  const [serverQuote, setServerQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const { config: primeCfg } = useVisionPrimeConfig(orgId);
  const { status: primeStatus } = useVisionPrimeStatus(orgId);
  const subtotal = cart.reduce((sum, item) => sum + getItemTotal(item), 0);
  const couponDiscount = appliedCoupon ? Math.min(appliedCoupon.discount, subtotal) : 0;
  const primeActive = Boolean(primeStatus.active && primeCfg?.ativo);
  const primeDiscount = primeActive
    ? +(subtotal * (Number(primeCfg!.desconto_percentual) || 0) / 100).toFixed(2)
    : 0;
  const discount = Math.min(subtotal, couponDiscount + primeDiscount);
  const rawFee = orderType === 'viagem' ? Number(deliveryFee || 0) : 0;
  const primeFreeShipping = primeActive && (Number(primeCfg!.frete_gratis_minimo) || 0) <= subtotal;
  const fee = primeFreeShipping ? 0 : rawFee;
  const feeWaived = primeFreeShipping ? rawFee : 0;
  const clientTotal = Math.max(0, subtotal - discount + fee);
  const authoritativeSubtotal = serverQuote ? Number(serverQuote.subtotal) : subtotal;
  const authoritativeCouponDiscount = serverQuote ? Number(serverQuote.coupon_discount || 0) : couponDiscount;
  const authoritativePrimeDiscount = serverQuote ? Number(serverQuote.prime_discount || 0) : primeDiscount;
  const authoritativeDiscount = serverQuote ? Number(serverQuote.discount || 0) : discount;
  const authoritativeFee = serverQuote ? Number(serverQuote.delivery_fee || 0) : fee;
  const authoritativeFeeWaived = serverQuote?.prime_shipping_waived ? rawFee : feeWaived;
  const total = serverQuote ? Number(serverQuote.total) : clientTotal;
  const primeSavings = authoritativePrimeDiscount + authoritativeFeeWaived;

  const quoteItems = cart.map(item => ({ product_id: item.product.id, quantity: item.quantity, extras: item.selectedExtras.map(e => e.name), weight_kg: item.weightKg ?? null, removedIngredients: item.removedIngredients }));

  useEffect(() => {
    if (!orgId || isDemoMode()) { setServerQuote(null); return; }
    let cancelled = false;
    setQuoteLoading(true); setQuoteError(''); setMpPix(null);
    supabase.rpc('quote_order_checkout_v2' as any, {
      _organization_id: orgId, _order_type: orderType, _bairro_id: bairroId || null,
      _delivery_fee: rawFee, _items: quoteItems, _coupon_code: appliedCoupon?.codigo || '',
      _delivery_context: { cep: deliveryCep || '' },
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) { setServerQuote(null); setQuoteError(error?.message || 'Não foi possível calcular o total no servidor.'); }
      else setServerQuote(data as any);
    }).finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, orderType, bairroId, rawFee, deliveryCep, appliedCoupon?.codigo, JSON.stringify(quoteItems)]);

  const pixKey = mpPix?.qr_code || storeSettings.pixKeyManual || '';
  const qrImageSrc = mpPix?.qr_code_base64 ? `data:image/png;base64,${mpPix.qr_code_base64}` : '';
  const pixConfigured = Boolean(storeSettings.pixKeyManual || storeSettings.mpEnabled);

  useEffect(() => {
    if (!orgId) return;
    const fetchSettings = async () => {
      const { data, error } = await supabase.from('settings').select('store_name, whatsapp_number, pix_key_manual, mp_access_token_secret_id, pay_cash_enabled, pay_pix_enabled, pay_card_terminal_enabled, pay_card_online_enabled, mp_terminal_id').eq('organization_id', orgId).maybeSingle();
      if (error) {
        console.warn('Não foi possível carregar as configurações de pagamento:', error);
        return;
      }
      if (data) {
        setStoreSettings({
          storeName: data.store_name || 'Vision Mídia',
          whatsappNumber: data.whatsapp_number || '',
          pixKeyManual: (data as any).pix_key_manual || '',
          mpEnabled: Boolean((data as any).mp_access_token_secret_id),
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
    if (!orgId || !storeSettings.mpEnabled || mpPix || mpLoading || quoteLoading || quoteError || (!isDemoMode() && !serverQuote) || isDemoMode() || total <= 0) return;
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
  }, [orgId, storeSettings.mpEnabled, total, mpPix, mpLoading, storeSettings.storeName, method, quoteLoading, quoteError, serverQuote]);



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
      if (bairroNome) msg += `🏘️ *BAIRRO:* ${bairroNome}\n`;
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
    if (appliedCoupon && authoritativeCouponDiscount > 0) {
      msg += `🏷️ *CUPOM:* ${appliedCoupon.codigo} (- ${formatCurrency(authoritativeCouponDiscount)})\n`;
    }
    if (authoritativePrimeDiscount > 0) msg += `👑 *VISION PRIME:* - ${formatCurrency(authoritativePrimeDiscount)}\n`;
    if (authoritativeFee > 0) {
      msg += `🛵 *TAXA DE ENTREGA:* ${formatCurrency(authoritativeFee)}${bairroTempo ? ` (~${bairroTempo} min)` : ''}\n`;
    } else if (authoritativeFeeWaived > 0) msg += `🛵 *TAXA DE ENTREGA:* GRÁTIS (Vision Prime)\n`;
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
    if (saving) return;
    setPaymentError('');
    if (!isDemoMode() && (quoteLoading || quoteError || !serverQuote)) {
      toast.error('Total ainda não foi validado pelo servidor.'); return;
    }
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

      if (!orgId) throw new Error('Loja não identificada. Recarregue o cardápio e tente novamente.');

      const orderItems = cart.map(item => ({
        product_id: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        price: item.product.price,
        total: getItemTotal(item),
        removedIngredients: item.removedIngredients,
        extras: item.selectedExtras.map(e => e.name),
        weight_kg: item.weightKg ?? null,
        price_per_kg: item.weightKg ? item.product.price : null,
        sold_by_weight: Boolean(item.weightKg),
      }));

      // Cria o pedido e reserva a senha na mesma transação do banco.
      const { data: checkoutRows, error } = await supabase.rpc('create_order_checkout_v2' as any, {
        _organization_id: orgId,
        _customer_name: customerName,
        _customer_phone: customerPhone,
        _customer_cpf: customerCpf || '',
        _order_type: orderType,
        _delivery_address: deliveryAddress || '',
        _delivery_reference: deliveryReference || '',
        _delivery_recipient: deliveryRecipient || '',
        _bairro_id: bairroId || null,
        _bairro_nome: bairroNome || '',
        _delivery_fee: rawFee,
        _items: orderItems,
        _total: total,
        _payment_method: method || '',
        _scheduled_for: scheduledFor || null,
        _coupon_code: appliedCoupon?.codigo || '',
        _delivery_context: { cep: deliveryCep || '' },
      });

      if (error) throw error;
      const data = Array.isArray(checkoutRows) ? checkoutRows[0] : checkoutRows;
      if (!data?.id || !data?.order_number) throw new Error('Checkout não retornou o pedido criado.');
      const num = String(data.order_number);
      setGeneratedNumber(num);

      // CPF é armazenado no pedido para exportação/integração fiscal posterior.
      // Não marque como NF-e emitida sem autorização fiscal/SEFAZ real.
      setConfirmed(true);
      if (data) {
        setCurrentOrderId(data.id);
        // Co-Marketing: recompensa só é consultada para cliente autenticado.
        // Pedidos anônimos não expõem mais uma RPC baseada apenas no UUID do pedido.
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: pg, error: giftError } = await supabase.rpc('parceria_generate_for_order' as any, { _order_id: data.id });
          if (!giftError) {
            const r = pg as any;
            if (r?.ok) {
              setPartnerGift({ codigo: r.codigo, discount_percent: Number(r.discount_percent), partner_name: r.partner_name, partner_slug: r.partner_slug });
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Error saving order:', err);
      const message = err?.message || 'Não foi possível registrar o pedido. Tente novamente.';
      setPaymentError(message);
      toast.error('Pedido não confirmado', { description: message });
      setConfirmed(false);
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
          <h2 className="text-3xl font-bold text-success">Pedido Confirmado!</h2>
          <div className="flex items-center justify-center gap-2 mt-3">
            <Ticket className="w-8 h-8 text-primary" />
            <span className="text-4xl font-black text-primary">#{generatedNumber}</span>
          </div>
          <p className="text-muted-foreground text-sm">Guarde sua senha. O pagamento será conferido conforme a forma escolhida.</p>
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
              {bairroNome && <p className="text-xs text-muted-foreground">🏘️ Bairro: <span className="text-foreground font-semibold">{bairroNome}</span></p>}
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
          {(authoritativeDiscount > 0 || rawFee > 0) && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(authoritativeSubtotal)}</span>
              </div>
              {authoritativeCouponDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-success">Cupom {appliedCoupon?.codigo}</span>
                  <span className="text-success font-semibold">- {formatCurrency(authoritativeCouponDiscount)}</span>
                </div>
              )}
              {authoritativePrimeDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-1" style={{ color: '#f4d28b' }}><Crown className="w-3 h-3" /> Vision Prime ({primeCfg?.desconto_percentual}%)</span>
                  <span className="font-semibold" style={{ color: '#f4d28b' }}>- {formatCurrency(authoritativePrimeDiscount)}</span>
                </div>
              )}
              {rawFee > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">🛵 Taxa de entrega {bairroNome ? `(${bairroNome})` : ''}</span>
                  {authoritativeFeeWaived > 0 ? (
                    <span className="font-semibold" style={{ color: '#f4d28b' }}>GRÁTIS <span className="line-through text-muted-foreground ml-1">{formatCurrency(rawFee)}</span></span>
                  ) : (
                    <span className="font-semibold">+ {formatCurrency(authoritativeFee)}</span>
                  )}
                </div>
              )}
            </>
          )}
          {primeSavings > 0 && (
            <div className="rounded-lg px-3 py-2 text-xs font-bold flex items-center gap-2"
              style={{ background: 'linear-gradient(135deg,rgba(246,197,96,0.15),rgba(212,136,30,0.1))', border: '1px solid rgba(212,160,76,0.4)', color: '#f4d28b' }}>
              <Crown className="w-4 h-4" /> Você economizou {formatCurrency(primeSavings)} nesta compra com seu Vision Prime
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="font-bold text-lg">TOTAL</span>
            <span className="font-black text-xl text-primary">{formatCurrency(total)}</span>
          </div>
        </div>



        {partnerGift && (
          <div className="w-full rounded-2xl p-5 border-2 animate-in fade-in zoom-in duration-500"
               style={{ background: 'linear-gradient(135deg, rgba(246,197,96,0.18), rgba(244,113,38,0.15))', borderColor: 'rgba(246,197,96,0.6)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl animate-bounce">🎁</span>
              <h3 className="font-black text-lg" style={{ color: '#f4d28b' }}>Você ganhou um presente!</h3>
            </div>
            <p className="text-sm mb-3">Cortesia do nosso parceiro <b>{partnerGift.partner_name}</b>: <b>{partnerGift.discount_percent}% de desconto</b> na próxima compra.</p>
            <div className="bg-background/60 border border-border rounded-lg px-3 py-2 flex items-center justify-between gap-2 mb-3">
              <code className="font-mono font-bold tracking-wider">{partnerGift.codigo}</code>
              <button onClick={() => { navigator.clipboard.writeText(partnerGift.codigo); setCopiedPartner(true); setTimeout(() => setCopiedPartner(false), 1500); }}
                      className="touch-btn bg-muted px-3 py-1.5 rounded-md text-xs flex items-center gap-1">
                {copiedPartner ? <><Check className="w-3 h-3" /> Copiado</> : <><Copy className="w-3 h-3" /> Copiar</>}
              </button>
            </div>
            <a href={`/loja/${partnerGift.partner_slug}`} target="_blank" rel="noopener noreferrer"
               className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold flex items-center justify-center gap-2">
              Ir para a Loja Parceira →
            </a>
          </div>
        )}




        <button onClick={handleSendToKitchen} className="touch-btn w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3">
          <MessageCircle className="w-7 h-7" /> ENVIAR PEDIDO PARA A COZINHA
        </button>


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
    storeSettings.payPix && pixConfigured && { key: 'pix' as Method, label: 'Pix (QR Code)', desc: 'Pague pelo app do seu banco', icon: <QrCode className="w-6 h-6" /> },
    storeSettings.payCash && { key: 'cash' as Method, label: 'Dinheiro no Balcão', desc: 'Pagar ao retirar o pedido', icon: <Banknote className="w-6 h-6" /> },
    storeSettings.payTerminal && { key: 'terminal' as Method, label: 'Cartão na Maquininha', desc: 'Passe o cartão na maquininha ao lado', icon: <CreditCard className="w-6 h-6" /> },
    // Cartão online permanece oculto até existir checkout tokenizado pelo gateway.
    // Não coletar PAN/CVV diretamente no VisionFood.
    false && storeSettings.payOnline && { key: 'online' as Method, label: 'Cartão Online', desc: 'Indisponível até configurar gateway seguro', icon: <Globe className="w-6 h-6" /> },
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
          {quoteError && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{quoteError}</div>}
          <div className="text-center mb-2">
            <p className="text-sm text-muted-foreground">Total a pagar</p>
            <p className="text-3xl font-black text-primary">{quoteLoading ? 'Calculando...' : formatCurrency(total)}</p>
          </div>
          {availableMethods.length === 0 ? (
            <div className="kiosk-card p-6 text-center space-y-2">
              <p className="font-bold">Nenhuma forma de pagamento ativa</p>
              <p className="text-xs text-muted-foreground">Peça ao lojista para habilitar pelo menos uma opção de pagamento nas configurações.</p>
            </div>
          ) : availableMethods.map(m => (
            <button key={m.key} disabled={quoteLoading || Boolean(quoteError) || (!isDemoMode() && !serverQuote)} onClick={() => setMethod(m.key)} className="touch-btn w-full kiosk-card p-4 flex items-center gap-4 text-left hover:border-primary border-2 border-transparent transition-colors">
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
          {paymentError && (
            <div role="alert" className="w-full rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{paymentError}</div>
          )}
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
          {paymentError && (
            <div role="alert" className="w-full rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{paymentError}</div>
          )}
          <button onClick={handleConfirmPayment} disabled={saving} className="touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">
            <Check className="w-6 h-6" /> {saving ? 'Salvando...' : 'Confirmar Pedido após usar a Maquininha'}
          </button>
        </div>
      </div>
    );
  }

  // Cartão online não renderiza formulário local: dados sensíveis devem ser tokenizados pelo provedor de pagamento.

  // === Pix (default original flow) ===
  return (
    <div className="min-h-screen flex flex-col">
      <Header title={<>Pagamento <span className="text-primary">PIX</span></>} />
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 max-w-md mx-auto">
        <p className="text-muted-foreground text-sm">
          {mpLoading ? 'Gerando QR Code Pix...' : 'Escaneie o QR Code ou copie a chave'}
        </p>
        {qrImageSrc ? (
          <div className="bg-foreground rounded-2xl p-4">
            <img src={qrImageSrc} alt="QR Code PIX" width={250} height={250} className="rounded-lg" />
          </div>
        ) : storeSettings.mpEnabled && mpLoading ? (
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        ) : storeSettings.pixKeyManual ? (
          <div className="w-full kiosk-card p-4 text-center text-sm text-muted-foreground">Use a chave Pix configurada abaixo.</div>
        ) : (
          <div role="alert" className="w-full rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">Pix indisponível no momento. Volte e escolha outra forma de pagamento.</div>
        )}
        {storeSettings.pixKeyManual && (
          <div className="w-full text-center">
            <p className="text-xs text-muted-foreground mb-1">Chave Pix:</p>
            <p className="font-mono text-sm bg-muted/50 px-3 py-2 rounded-lg break-all">{storeSettings.pixKeyManual}</p>
          </div>
        )}
        {pixKey && (
          <div className="w-full">
            <p className="text-sm text-muted-foreground text-center mb-2">
              {mpPix ? 'Pix copia e cola:' : 'Chave PIX (copia e cola):'}
            </p>
            <button onClick={handleCopy} className="w-full flex items-center justify-center gap-2 bg-muted px-4 py-3 rounded-xl transition-all active:scale-95">
              {copied ? <Check className="w-5 h-5 text-success" /> : <Copy className="w-5 h-5 text-muted-foreground" />}
              <span className="font-mono text-xs break-all line-clamp-2">{pixKey}</span>
            </button>
          </div>
        )}

        <div className="text-center"><p className="text-2xl font-black text-primary">{formatCurrency(total)}</p></div>
        {paymentError && (
          <div role="alert" className="w-full rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{paymentError}</div>
        )}
        <button onClick={handleConfirmPayment} disabled={saving || (!pixKey && !mpLoading)} className="touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">
          <Check className="w-6 h-6" /> {saving ? 'Salvando...' : 'Já enviei o PIX — registrar pedido'}
        </button>
      </div>
    </div>
  );
};

export default PaymentScreen;
