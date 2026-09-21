import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Check, MessageCircle, CheckCircle2, Ticket, Banknote, QrCode, CreditCard, Globe, Loader2, CalendarClock, ShoppingCart } from 'lucide-react';
import { CartItem, getItemTotal, formatCurrency, StoreSettings } from '@/data/store';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';
import { isDemoMode } from '@/lib/demoMode';
import type { AppliedCoupon } from './CartScreen';
import { canQueueOffline, clearPendingCheckout, createClientRequestId, loadPendingCheckout, savePendingCheckout, type PendingCheckoutDraft } from '@/lib/offlineCheckoutQueue';
import { useVisionPrimeConfig, useVisionPrimeStatus } from '@/hooks/useVisionPrime';
import { Crown } from 'lucide-react';
import { enqueueOfflineOrderOnCompanion, getKioskCompanionQueue, syncKioskCompanionQueueOnce } from '@/lib/kioskCompanionClient';
import { fetchPublicCheckoutPaymentConfig } from '@/lib/publicCheckoutPaymentConfig';
import { isCheckoutQuoteReady } from '@/lib/checkoutQuoteReadiness';
import { computeStatus, getSpecialClosure, localDateKey, useStoreStatus } from '@/hooks/useStoreStatus';

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
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  deliveryAccuracyM?: number | null;
  appliedCoupon?: AppliedCoupon | null;
  scheduledFor?: string | null;
  tableToken?: string;
  tableLabel?: string;
  deviceOwnedKiosk?: boolean;
  onBack: () => void;
  onScheduleAnotherDay?: () => void;
  onBackToCart?: () => void;
  onDone: (orderId?: string) => void;
}


const PaymentScreen = ({ cart, customerName, customerPhone, customerCpf, orderType, deliveryAddress, deliveryReference, deliveryRecipient, bairroId, bairroNome, deliveryFee = 0, bairroTempo, deliveryCep, deliveryLat, deliveryLng, deliveryAccuracyM, appliedCoupon, scheduledFor, tableToken = '', tableLabel = '', deviceOwnedKiosk = false, onBack, onScheduleAnotherDay, onBackToCart, onDone }: PaymentScreenProps) => {
  const orgId = useOrgId();
  type Method = 'pix' | 'cash' | 'terminal' | 'online';
  const recoveredDraft = !deviceOwnedKiosk && orgId ? loadPendingCheckout(orgId) : null;
  const [method, setMethod] = useState<Method | null>((recoveredDraft?.method as Method | undefined) || null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [generatedNumber, setGeneratedNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [checkoutBlockReason, setCheckoutBlockReason] = useState<'special_closure' | ''>('');
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [offlineQueued, setOfflineQueued] = useState(() => recoveredDraft?.state === 'queued_offline');
  const [companionLocalOrderId, setCompanionLocalOrderId] = useState(recoveredDraft?.companionLocalOrderId || '');
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [clientRequestId] = useState(() => recoveredDraft?.clientRequestId || createClientRequestId());
  const [deliveryCode, setDeliveryCode] = useState('');
  const [partnerGift, setPartnerGift] = useState<{ codigo: string; discount_percent: number; partner_name: string; partner_slug: string } | null>(null);
  const [copiedPartner, setCopiedPartner] = useState(false);
  const [storeSettings, setStoreSettings] = useState<{
    storeName: string; whatsappNumber: string; pixKeyManual: string;
    payCash: boolean; payPix: boolean; payTerminal: boolean; payOnline: boolean; terminalId: string;
  }>({ storeName: 'Vision Mídia', whatsappNumber: '', pixKeyManual: '', payCash: true, payPix: true, payTerminal: false, payOnline: false, terminalId: '' });
  const [serverQuote, setServerQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const { config: primeCfg } = useVisionPrimeConfig(orgId, !deviceOwnedKiosk);
  const { status: primeStatus } = useVisionPrimeStatus(orgId, !deviceOwnedKiosk);
  const storeStatus = useStoreStatus(orgId);
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
  const authoritativeQuoteReady = isCheckoutQuoteReady({
    deviceOwnedKiosk,
    demoMode: isDemoMode(),
    quoteLoading,
    quoteError,
    serverQuote,
  });
  const primeSavings = authoritativePrimeDiscount + authoritativeFeeWaived;
  const normalizedCustomerPhone = customerPhone.replace(/\D/g, '');
  const effectiveCustomerName = customerName.trim() || 'Cliente Totem';
  const effectiveCustomerPhone = normalizedCustomerPhone.length >= 8 ? normalizedCustomerPhone : '';
  const customerDisplay = customerName.trim()
    ? [customerName.trim(), effectiveCustomerPhone].filter(Boolean).join(' — ')
    : 'Visitante';

  const quoteItems = cart.map(item => ({ product_id: item.product.id, quantity: item.quantity, extras: item.selectedExtras.map(e => e.name), weight_kg: item.weightKg ?? null, removedIngredients: item.removedIngredients }));
  const hasDeliveryGps = orderType === 'viagem'
    && typeof deliveryLat === 'number'
    && Number.isFinite(deliveryLat)
    && typeof deliveryLng === 'number'
    && Number.isFinite(deliveryLng);
  const deliveryContext = {
    cep: deliveryCep || '',
    ...(hasDeliveryGps ? {
      lat: Number(deliveryLat),
      lng: Number(deliveryLng),
      accuracy_m: typeof deliveryAccuracyM === 'number' && Number.isFinite(deliveryAccuracyM)
        ? Math.max(0, deliveryAccuracyM)
        : null,
    } : {}),
  };

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  useEffect(() => {
    if (!orgId || isDemoMode() || deviceOwnedKiosk) {
      setServerQuote(null);
      setQuoteLoading(false);
      setQuoteError('');
      return;
    }
    if (!isOnline) { setQuoteLoading(false); setQuoteError('Conexão necessária para o checkout web.'); return; }
    let cancelled = false;
    setQuoteLoading(true); setQuoteError('');
    supabase.rpc('quote_order_checkout_v2' as any, {
      _organization_id: orgId, _order_type: orderType, _bairro_id: bairroId || null,
      _delivery_fee: rawFee, _items: quoteItems, _coupon_code: appliedCoupon?.codigo || '',
      _delivery_context: deliveryContext,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) { setServerQuote(null); setQuoteError(error?.message || 'Não foi possível calcular o total no servidor.'); }
      else setServerQuote(data as any);
    }).finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, orderType, bairroId, rawFee, deliveryCep, deliveryLat, deliveryLng, deliveryAccuracyM, appliedCoupon?.codigo, JSON.stringify(quoteItems), isOnline, deviceOwnedKiosk]);

  const pixKey = storeSettings.pixKeyManual || '';
  const pixConfigured = Boolean(pixKey);

  useEffect(() => {
    if (!orgId) return;
    const fetchSettings = async () => {
      try {
        const config = await fetchPublicCheckoutPaymentConfig(orgId);
        setStoreSettings({
          storeName: config.store_name || 'VisionFood',
          whatsappNumber: config.whatsapp_number || '',
          pixKeyManual: config.pix_key_manual || '',
          payCash: config.pay_cash_enabled !== false,
          payPix: config.pay_pix_enabled !== false,
          payTerminal: Boolean(config.pay_card_terminal_enabled),
          payOnline: Boolean(config.pay_card_online_enabled),
          terminalId: config.mp_terminal_id || '',
        });
      } catch (error) {
        console.warn('Não foi possível carregar as configurações públicas de pagamento:', error);
      }
    };
    void fetchSettings();
  }, [orgId]);



  const handleCopy = () => {
    navigator.clipboard.writeText(pixKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buildWhatsAppMessage = () => {
    let msg = `🧾 *NOVO PEDIDO - ${storeSettings.storeName}*\n\n`;
    msg += `🔢 *SENHA DO PEDIDO: #${generatedNumber}*\n\n`;
    msg += `👤 *CLIENTE:* ${customerDisplay}\n`;
    msg += `📍 *LOCAL:* ${orderType === 'local' ? (tableLabel ? `Comer no Local — ${tableLabel}` : 'Comer no Local') : 'Para Viagem (Entrega)'}\n`;
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

  const handleShareWhatsApp = () => {
    const phone = storeSettings.whatsappNumber.replace(/\D/g, '');
    if (!phone) {
      toast.error('WhatsApp da loja não configurado.');
      return;
    }
    const whatsappUrl = `https://wa.me/${phone}?text=${buildWhatsAppMessage()}`;
    window.open(whatsappUrl, '_blank', 'noopener');
  };

  const buildPendingDraft = (state: 'submitting' | 'queued_offline', selectedMethod: Method): PendingCheckoutDraft => ({
    version: 1,
    organizationId: orgId || '',
    clientRequestId,
    state,
    createdAt: recoveredDraft?.createdAt || new Date().toISOString(),
    method: selectedMethod,
    cart,
    customerName,
    customerPhone,
    customerCpf: customerCpf || '',
    orderType,
    deliveryAddress: deliveryAddress || '',
    deliveryReference: deliveryReference || '',
    deliveryRecipient: deliveryRecipient || '',
    bairroId: bairroId || '',
    bairroNome: bairroNome || '',
    bairroTaxa: rawFee,
    bairroTempo: Number(bairroTempo || 0),
    deliveryCep: deliveryCep || '',
    deliveryLat: hasDeliveryGps ? deliveryLat : null,
    deliveryLng: hasDeliveryGps ? deliveryLng : null,
    deliveryAccuracyM: hasDeliveryGps && typeof deliveryAccuracyM === 'number' && Number.isFinite(deliveryAccuracyM)
      ? Math.max(0, deliveryAccuracyM)
      : null,
    appliedCoupon: appliedCoupon || null,
    scheduledFor: scheduledFor || null,
    tableToken,
    tableLabel,
  });

  const buildCompanionOfflineDraft = () => ({
    organization_id: orgId || '',
    payment_method: 'cash' as const,
    payment_status: 'pending' as const,
    customer_name: effectiveCustomerName,
    customer_phone: effectiveCustomerPhone,
    customer_cpf: customerCpf || '',
    order_type: orderType,
    delivery_address: deliveryAddress || '',
    delivery_reference: deliveryReference || '',
    delivery_recipient: deliveryRecipient || '',
    bairro_id: bairroId || null,
    bairro_nome: bairroNome || '',
    delivery_fee: rawFee,
    items: quoteItems,
    scheduled_for: scheduledFor || null,
    coupon_code: appliedCoupon?.codigo || '',
    delivery_context: deliveryContext,
    table_token: tableToken || null,
    offline_snapshot: {
      displayed_subtotal: authoritativeSubtotal,
      displayed_coupon_discount: authoritativeCouponDiscount,
      displayed_delivery_fee: authoritativeFee,
      displayed_total: total,
      prime_discount: authoritativePrimeDiscount,
      prime_shipping_waived: authoritativeFeeWaived > 0,
    },
  });

  const handleConfirmPayment = async () => {
    if (saving) return;
    setPaymentError('');
    setCheckoutBlockReason('');

    if (!isDemoMode() && deviceOwnedKiosk) {
      if (!method) {
        setPaymentError('Escolha uma forma de pagamento.');
        return;
      }
      if (!orgId) {
        setPaymentError('Loja não identificada. Recarregue o cardápio e tente novamente.');
        return;
      }
      if (!canQueueOffline(method)) {
        const message = 'Esta forma de pagamento exige conexão com o servidor. Nenhum pagamento será repetido ou confirmado offline.';
        setPaymentError(message);
        toast.error('Conexão obrigatória', { description: message });
        return;
      }

      setSaving(true);
      try {
        const queued = await enqueueOfflineOrderOnCompanion(buildCompanionOfflineDraft());
        const localOrderId = String(queued.local_order_id || '');
        const queueClientRequestId = String(queued.client_request_id || '');
        if (!localOrderId || !queueClientRequestId) {
          throw new Error('companion_queue_ack_invalid');
        }

        clearPendingCheckout();
        setCompanionLocalOrderId(localOrderId);
        setOfflineQueued(true);
        setPaymentError('');
        toast.info(isOnline
          ? 'Pedido entregue à fila segura do totem e aguardando validação autoritativa.'
          : 'Pedido salvo na fila segura deste dispositivo. Ele ainda não foi enviado à cozinha.');
      } catch (error: any) {
        const message = String(error?.message || 'companion_unavailable');
        setPaymentError(
          message.includes('device_not_enrolled')
            ? 'Este totem ainda não possui identidade de dispositivo válida. O pedido não foi enfileirado.'
            : 'Não foi possível gravar o pedido na fila durável do totem. O pedido não foi confirmado.',
        );
        toast.error('Fila offline indisponível', { description: 'Nenhum pedido foi criado no servidor.' });
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!isDemoMode() && !isOnline) {
      const message = 'O checkout web autenticado exige conexão. O pedido não foi enviado como pedido do dispositivo.';
      setPaymentError(message);
      toast.error('Conexão obrigatória', { description: message });
      return;
    }

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
      if (!method) throw new Error('Escolha uma forma de pagamento.');

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

      // Persiste a mesma chave antes da chamada: se a resposta se perder, o retry não cria outro pedido.
      savePendingCheckout(buildPendingDraft('submitting', method));

      const { data: checkoutRows, error } = await supabase.rpc('create_order_checkout_v4', {
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
        _delivery_context: deliveryContext,
        _table_token: tableToken || null,
        _client_request_id: clientRequestId,
      });

      if (error) throw error;
      const data = Array.isArray(checkoutRows) ? checkoutRows[0] : checkoutRows;
      if (!data?.id || !data?.order_number) throw new Error('Checkout não retornou o pedido criado.');
      clearPendingCheckout(clientRequestId);
      setOfflineQueued(false);
      const num = String(data.order_number);
      setGeneratedNumber(num);
      setDeliveryCode(String(data.delivery_code || ''));

      // CPF é armazenado no pedido para exportação/integração fiscal posterior.
      // Não marque como NF-e emitida sem autorização fiscal/SEFAZ real.
      setConfirmed(true);
      if (data) {
        setCurrentOrderId(data.id);
        // Co-Marketing: a RPC atual já é restrita a authenticated e valida
        // ownership com auth.uid(); não faça uma segunda leitura de Auth aqui,
        // pois ela é desnecessária e pode disputar o lock de sessão no mobile.
        const { data: pg, error: giftError } = await supabase.rpc('parceria_generate_for_order' as any, { _order_id: data.id });
        if (!giftError) {
          const r = pg as any;
          if (r?.ok) {
            setPartnerGift({ codigo: r.codigo, discount_percent: Number(r.discount_percent), partner_name: r.partner_name, partner_slug: r.partner_slug });
          }
        }
      }
    } catch (err: any) {
      console.error('Error saving order:', err);
      const rawMessage = String(err?.message || '');
      const authExpired = /authentication_required|jwt expired|invalid jwt|token has expired/i.test(rawMessage);
      const specialClosureError = rawMessage.includes('store_closed_special_date');
      setRequiresLogin(authExpired);
      setCheckoutBlockReason(specialClosureError ? 'special_closure' : '');
      const message = authExpired
        ? 'Sua sessão expirou. Entre novamente para sincronizar este pedido com segurança.'
        : specialClosureError
          ? 'A loja está fechada na data escolhida.'
        : rawMessage.includes('schedule_slot_full')
          ? 'Esse horário atingiu o limite de pedidos. Volte e escolha outro horário.'
        : rawMessage.includes('schedule_slot_alignment')
          ? 'O horário escolhido não corresponde aos intervalos de agendamento da loja.'
        : rawMessage.includes('schedule_outside_business_hours')
          ? 'A loja não funciona no horário agendado. Volte e escolha outro horário.'
        : rawMessage.includes('scheduling_disabled')
          ? 'A loja desativou os agendamentos neste momento.'
        : rawMessage.includes('schedule_must_be_future')
          ? 'O horário agendado precisa ser futuro.'
        : rawMessage.includes('checkout_phone_rate_limited')
        ? 'Muitos pedidos foram enviados em pouco tempo com este telefone. Aguarde alguns minutos e tente novamente.'
        : rawMessage.includes('checkout_rate_limited')
          ? 'A loja está recebendo muitos pedidos neste momento. Aguarde um instante e tente novamente.'
          : rawMessage.includes('payment_method_disabled')
            ? 'Essa forma de pagamento foi desativada pela loja. Volte e escolha outra opção.'
            : rawMessage.includes('invalid_table_token') || rawMessage.includes('table_orders_disabled')
              ? 'Esta mesa não está mais disponível. Leia novamente o QR correto da mesa.'
              : rawMessage.includes('invalid removed ingredient for product')
              ? 'Este produto foi atualizado pela loja. Volte ao carrinho, revise os ingredientes e tente novamente.'
              : rawMessage || 'Não foi possível registrar o pedido. Tente novamente.';
      setPaymentError(message);
      if (specialClosureError) {
        toast.error('Loja fechada', { description: 'Escolha outro dia para receber ou retirar seu pedido.' });
      } else {
        toast.error('Pedido não confirmado', { description: message });
      }
      setConfirmed(false);
    } finally {
      setSaving(false);
    }
  };


  const specialClosureBlocked = checkoutBlockReason === 'special_closure';
  const closureTargetCandidate = scheduledFor ? new Date(scheduledFor) : new Date();
  const closureTargetDate = Number.isNaN(closureTargetCandidate.getTime()) ? new Date() : closureTargetCandidate;
  const closureRecord = getSpecialClosure(closureTargetDate, storeStatus.specialClosures);
  const closureReason = closureRecord?.reason || storeStatus.specialClosureReason || 'Data programada';
  const closureIsToday = localDateKey(closureTargetDate) === localDateKey(new Date());
  const closureStatus = computeStatus(closureTargetDate, storeStatus.hours, storeStatus.specialClosures);
  const nextOpening = scheduledFor ? closureStatus.nextOpenAt : storeStatus.nextOpenAt;
  const nextOpeningLabel = nextOpening
    ? nextOpening.toLocaleString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const scheduledOrderDate = scheduledFor ? new Date(scheduledFor) : null;
  const validScheduledOrderDate = scheduledOrderDate && !Number.isNaN(scheduledOrderDate.getTime())
    ? scheduledOrderDate
    : null;
  const scheduledOrderLabel = validScheduledOrderDate
    ? validScheduledOrderDate.toLocaleString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const renderPaymentError = () => {
    if (!paymentError) return null;

    if (!specialClosureBlocked) {
      return (
        <div role="alert" className="w-full rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {paymentError}
        </div>
      );
    }

    return (
      <div role="alert" className="w-full rounded-2xl border border-primary/35 bg-primary/5 p-4 text-left space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
            <CalendarClock className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-black text-foreground">
              {closureIsToday ? 'Loja fechada hoje' : `Loja fechada em ${closureTargetDate.toLocaleDateString('pt-BR')}`} — {closureReason}
            </p>
            {nextOpeningLabel ? (
              <p className="text-sm text-muted-foreground mt-1">
                Próxima abertura: <strong className="text-foreground capitalize">{nextOpeningLabel}</strong>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                Consulte a loja para confirmar a próxima abertura.
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {storeStatus.schedulingEnabled && (
            <button
              type="button"
              onClick={onScheduleAnotherDay || onBack}
              className="touch-btn w-full rounded-xl bg-primary text-primary-foreground px-4 py-3 font-bold flex items-center justify-center gap-2"
            >
              <CalendarClock className="w-4 h-4" /> Agendar para outro dia
            </button>
          )}
          <button
            type="button"
            onClick={onBackToCart || onBack}
            className="touch-btn w-full rounded-xl bg-muted px-4 py-3 font-bold flex items-center justify-center gap-2"
          >
            <ShoppingCart className="w-4 h-4" /> Voltar ao carrinho
          </button>
        </div>
      </div>
    );
  };

  // Payment method availability must be resolved before any conditional return
  // so hook order remains stable when the checkout transitions to confirmed/offline states.
  const configuredMethods: { key: Method; label: string; desc: string; icon: JSX.Element }[] = [
    storeSettings.payPix && pixConfigured && { key: 'pix' as Method, label: 'Pix', desc: 'Copie a chave Pix da loja e pague pelo app do seu banco', icon: <QrCode className="w-6 h-6" /> },
    storeSettings.payCash && { key: 'cash' as Method, label: 'Dinheiro no Balcão', desc: 'Pagar ao retirar o pedido', icon: <Banknote className="w-6 h-6" /> },
    storeSettings.payTerminal && { key: 'terminal' as Method, label: 'Cartão na Maquininha', desc: 'Passe o cartão na maquininha ao lado', icon: <CreditCard className="w-6 h-6" /> },
    // Cartão online permanece oculto até existir checkout tokenizado pelo gateway.
    // Não coletar PAN/CVV diretamente no VisionFood.
    false && storeSettings.payOnline && { key: 'online' as Method, label: 'Cartão Online', desc: 'Indisponível até configurar gateway seguro', icon: <Globe className="w-6 h-6" /> },
  ].filter(Boolean) as any;
  const availableMethods = deviceOwnedKiosk
    ? configuredMethods.filter((entry) => entry.key === 'cash')
    : configuredMethods;

  useEffect(() => {
    if (!method && availableMethods.length === 1 && authoritativeQuoteReady) {
      setMethod(availableMethods[0].key);
    }
  }, [method, availableMethods, authoritativeQuoteReady]);

  useEffect(() => {
    if (!offlineQueued || !isOnline || !orgId) return;

    const pending = deviceOwnedKiosk ? null : loadPendingCheckout(orgId);
    const localOrderId = deviceOwnedKiosk ? companionLocalOrderId : pending?.companionLocalOrderId;
    if (!localOrderId) {
      setPaymentError(deviceOwnedKiosk
        ? 'A fila segura não retornou o identificador local deste pedido.'
        : 'Este rascunho offline é anterior à fila segura por dispositivo. Ele foi preservado e precisa de revisão; não será enviado automaticamente.');
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const reconcile = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await syncKioskCompanionQueueOnce();
        const queue: any = await getKioskCompanionQueue();
        const item = Array.isArray(queue?.items)
          ? queue.items.find((entry: any) => entry.local_order_id === localOrderId)
          : null;
        if (cancelled || !item) return;

        if (item.state === 'synced' && item.authoritative_ack?.order_id) {
          const ack = item.authoritative_ack;
          if (pending?.clientRequestId) clearPendingCheckout(pending.clientRequestId);
          setOfflineQueued(false);
          setCurrentOrderId(String(ack.order_id));
          setGeneratedNumber(String(ack.order_number || ''));
          setDeliveryCode(String(ack.delivery_code || ''));
          setPaymentError('');
          setConfirmed(true);
          return;
        }

        if (item.state === 'needs_attention') {
          const reason = String(item.last_error || 'needs_attention');
          const message = reason.includes('commercial_terms_changed')
            ? 'Preço, desconto ou frete mudou enquanto o totem estava offline. O pedido foi preservado para revisão e não foi criado no servidor.'
            : reason.includes('customer_benefit_requires_authentication')
              ? 'Este pedido usava um benefício de cliente que exige autenticação. O pedido foi preservado para revisão.'
              : 'O servidor encontrou uma divergência que exige revisão. O pedido local foi preservado e não foi criado incorretamente.';
          setPaymentError(message);
        }
      } catch (error: any) {
        if (!cancelled) {
          setPaymentError('A fila local continua preservada. A sincronização autoritativa ainda não pôde ser concluída.');
        }
      } finally {
        inFlight = false;
      }
    };

    void reconcile();
    const timer = window.setInterval(() => { void reconcile(); }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [offlineQueued, isOnline, orgId, deviceOwnedKiosk, companionLocalOrderId]);

  if (offlineQueued && !confirmed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-5 max-w-md mx-auto text-center">
        <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center text-3xl">📡</div>
        <div className="space-y-2">
          <h2 className="text-2xl font-black">{isOnline ? 'Sincronizando pedido…' : 'Pedido salvo offline'}</h2>
          <p className="text-sm text-muted-foreground">
            {isOnline
              ? 'A conexão voltou. Estamos validando o total e enviando o pedido com a mesma chave idempotente.'
              : 'Este pedido está salvo neste dispositivo. Ainda não chegou à cozinha, não gerou senha e nenhum pagamento foi confirmado.'}
          </p>
          {tableLabel && <p className="font-bold text-primary">🍽️ {tableLabel}</p>}
        </div>
        <div className="w-full kiosk-card p-4 text-left text-sm space-y-1">
          <p><strong>Cliente:</strong> {customerDisplay}</p>
          <p><strong>Itens:</strong> {cart.reduce((sum, item) => sum + item.quantity, 0)}</p>
          <p><strong>Pagamento:</strong> Dinheiro no balcão</p>
        </div>
        {paymentError && <div role="alert" className="w-full rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{paymentError}</div>}
        {isOnline && paymentError && <p className="text-xs text-muted-foreground">A fila local permanece preservada. O companion continuará verificando a reconciliação sem transformar este pedido em checkout autenticado.</p>}
        {!isOnline && <p className="text-xs text-muted-foreground">Ao recuperar a conexão, o companion tentará a sincronização autoritativa automaticamente. A fila durável permanece no companion.</p>}
        {deviceOwnedKiosk && (
          <button onClick={() => onDone()} className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl text-lg font-bold">
            Liberar Totem para o Próximo Cliente
          </button>
        )}
      </div>
    );
  };

  if (confirmed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-6 max-w-md mx-auto">
        <div className="w-20 h-20 rounded-full bg-success/20 flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-success" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold text-success">{scheduledOrderLabel ? 'Pedido Agendado!' : 'Pedido Confirmado!'}</h2>
          {scheduledOrderLabel && (
            <div className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-bold">Data e horário agendados</p>
              <p className="text-primary font-black capitalize mt-1">{scheduledOrderLabel}</p>
            </div>
          )}
          <div className="flex items-center justify-center gap-2 mt-3">
            <Ticket className="w-8 h-8 text-primary" />
            <span className="text-4xl font-black text-primary">#{generatedNumber}</span>
          </div>
          <p className="text-muted-foreground text-sm">Guarde sua senha. O pagamento será conferido conforme a forma escolhida.</p>
        </div>

        {orderType === 'viagem' && deliveryCode && (
          <div className="w-full rounded-2xl border-2 border-orange-500/60 bg-orange-500/10 p-5 text-center space-y-2">
            <p className="text-xs uppercase tracking-wider text-orange-300 font-bold">Código de confirmação da entrega</p>
            <p className="text-4xl font-black tracking-[0.35em] text-orange-400 pl-[0.35em]">{deliveryCode}</p>
            <p className="text-xs text-muted-foreground">
              Guarde este código e informe ao entregador somente quando receber o pedido.
            </p>
          </div>
        )}

        <div className="w-full kiosk-card p-4 space-y-3">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">👤 Cliente</p>
            <p className="font-bold">{customerDisplay}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">📍 Local</p>
            <p className="font-bold">{orderType === 'local' ? (tableLabel ? `Comer no Local — ${tableLabel}` : 'Comer no Local') : 'Para Viagem'}</p>
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




        {!deviceOwnedKiosk && storeSettings.whatsappNumber && (
          <button onClick={handleShareWhatsApp} className="touch-btn w-full bg-success/10 border border-success/30 text-success py-4 rounded-xl text-base flex items-center justify-center gap-2">
            <MessageCircle className="w-5 h-5" /> Compartilhar pedido no WhatsApp
          </button>
        )}


        {currentOrderId && (
          <button onClick={() => onDone(currentOrderId)} className="touch-btn w-full bg-muted text-foreground py-4 rounded-xl text-lg flex items-center justify-center gap-2">
            📍 {scheduledOrderLabel ? 'Acompanhar Pedido Agendado' : 'Acompanhar Pedido'}
          </button>
        )}

        <button onClick={() => onDone()} className="touch-btn w-full bg-primary/10 border-2 border-primary text-primary py-4 rounded-xl text-lg flex items-center justify-center gap-2">
          {deviceOwnedKiosk ? '✅ Finalizar e liberar o totem' : '🏠 Voltar ao Menu Inicial'}
        </button>
      </div>
    );
  }

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
          {quoteError && !deviceOwnedKiosk && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{quoteError}</div>}
          {deviceOwnedKiosk && !isOnline && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">
              Sem internet: o valor exibido é um snapshot local e será revalidado pelo servidor antes da criação autoritativa do pedido.
            </div>
          )}
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
            <button key={m.key} disabled={!authoritativeQuoteReady} onClick={() => setMethod(m.key)} className="touch-btn w-full kiosk-card p-4 flex items-center gap-4 text-left hover:border-primary border-2 border-transparent transition-colors disabled:opacity-50">
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
          {renderPaymentError()}
          {!authoritativeQuoteReady && !deviceOwnedKiosk && (
            <div role="status" className="w-full rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">
              {quoteError ? 'Não foi possível validar o total no servidor.' : 'Validando o total no servidor…'}
            </div>
          )}
          {!specialClosureBlocked && (
            <button onClick={handleConfirmPayment} disabled={saving || !authoritativeQuoteReady} className="touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">
              <Check className="w-6 h-6" /> {saving ? 'Salvando...' : !authoritativeQuoteReady ? 'Validando total…' : 'Confirmar Pedido'}
            </button>
          )}
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
          {!specialClosureBlocked && <Loader2 className="w-8 h-8 text-primary animate-spin" />}
          {renderPaymentError()}
          {!specialClosureBlocked && (
            <button onClick={handleConfirmPayment} disabled={saving || !authoritativeQuoteReady} className="touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">
              <Check className="w-6 h-6" /> {saving ? 'Salvando...' : !authoritativeQuoteReady ? 'Validando total…' : 'Confirmar Pedido após usar a Maquininha'}
            </button>
          )}
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
        <p className="text-muted-foreground text-sm text-center">
          Copie a chave Pix abaixo, faça o pagamento no app do seu banco e depois confirme o pedido.
        </p>
        {pixKey ? (
          <div className="w-full kiosk-card p-4 space-y-3">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Chave Pix:</p>
              <p className="font-mono text-sm bg-muted/50 px-3 py-2 rounded-lg break-all">{pixKey}</p>
            </div>
            <button onClick={handleCopy} className="w-full flex items-center justify-center gap-2 bg-muted px-4 py-3 rounded-xl transition-all active:scale-95">
              {copied ? <Check className="w-5 h-5 text-success" /> : <Copy className="w-5 h-5 text-muted-foreground" />}
              <span className="font-semibold text-sm">{copied ? 'Chave copiada' : 'Copiar chave Pix'}</span>
            </button>
          </div>
        ) : (
          <div role="alert" className="w-full rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Pix indisponível no momento. Volte e escolha outra forma de pagamento.
          </div>
        )}

        <div className="text-center"><p className="text-2xl font-black text-primary">{formatCurrency(total)}</p></div>
        {renderPaymentError()}
        {!specialClosureBlocked && (
          <button onClick={handleConfirmPayment} disabled={saving || !pixKey || !authoritativeQuoteReady} className="touch-btn cta-breath w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">
            <Check className="w-6 h-6" /> {saving ? 'Salvando...' : !authoritativeQuoteReady ? 'Validando total…' : 'Já enviei o PIX — registrar pedido'}
          </button>
        )}
      </div>
    </div>
  );
};

export default PaymentScreen;
