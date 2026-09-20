import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useOrgId } from '@/contexts/OrgContext';
import StartScreen from '@/components/kiosk/StartScreen';
import LocationSelect from '@/components/kiosk/LocationSelect';
import AddressSelect from '@/components/kiosk/AddressSelect';
import MenuScreen from '@/components/kiosk/MenuScreen';
import CartScreen from '@/components/kiosk/CartScreen';
import CheckoutScreen from '@/components/kiosk/CheckoutScreen';
import PaymentScreen from '@/components/kiosk/PaymentScreen';
import TotemSuccess from '@/components/kiosk/TotemSuccess';
import LandingScreen from '@/components/kiosk/LandingScreen';
import NotificationBell from '@/components/kiosk/NotificationBell';
import PartnersFooter from '@/components/kiosk/PartnersFooter';
import { CartItem, Product } from '@/data/store';
import type { AppliedCoupon } from '@/components/kiosk/CartScreen';
import { supabase } from '@/integrations/supabase/client';
import { fetchPublicStorefrontConfig } from '@/lib/publicStorefrontConfig';
import { toast } from 'sonner';
import { clearPendingCheckout, loadPendingCheckout } from '@/lib/offlineCheckoutQueue';
import { getKioskCompanionStatus } from '@/lib/kioskCompanionClient';
import { clearKioskCustomerBrowserState, isDeviceOwnedKioskStatus } from '@/lib/kioskDeviceMode';
import { warmKioskPublicData } from '@/lib/kioskPublicDataWarmup';

type Step = 'landing' | 'start' | 'location' | 'address' | 'menu' | 'cart' | 'checkout' | 'payment' | 'tracking';

const PENDING_ORDER_STORAGE_KEY = 'pending-kiosk-order';

interface PendingOrderState {
  step: Step;
  orderType: 'local' | 'viagem';
  cart: CartItem[];
  customerName: string;
  customerPhone: string;
  customerCpf: string;
  deliveryAddress: string;
  deliveryReference: string;
  deliveryRecipient: string;
  bairroId: string;
  bairroNome: string;
  bairroTaxa: number;
  bairroTempo: number;
  deliveryCep: string;
  tableToken: string;
  tableLabel: string;
}

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const orgId = useOrgId();
  const homePath = slug ? `/cardapio/${slug}` : '/';
  const isPhysicalKioskRoute = location.pathname.startsWith('/cardapio/');
  const [step, setStep] = useState<Step>('landing');
  const [orderType, setOrderType] = useState<'local' | 'viagem'>('local');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCpf, setCustomerCpf] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryReference, setDeliveryReference] = useState('');
  const [deliveryRecipient, setDeliveryRecipient] = useState('');
  const [bairroId, setBairroId] = useState('');
  const [bairroNome, setBairroNome] = useState('');
  const [bairroTaxa, setBairroTaxa] = useState(0);
  const [bairroTempo, setBairroTempo] = useState(0);
  const [deliveryCep, setDeliveryCep] = useState('');
  const [trackingOrderId, setTrackingOrderId] = useState('');
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [deliveryEnabled, setDeliveryEnabled] = useState<boolean>(true);
  const [tableToken, setTableToken] = useState('');
  const [tableLabel, setTableLabel] = useState('');
  const [deviceOwnedKiosk, setDeviceOwnedKiosk] = useState(false);
  const [deviceModeOrgId, setDeviceModeOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setDeliveryEnabled(true); return; }
    let cancelled = false;

    const loadStorefrontConfig = async () => {
      try {
        const data = await fetchPublicStorefrontConfig(orgId);
        if (cancelled) return;

        const enabled = data.delivery_enabled !== false;
        setDeliveryEnabled(enabled);
        if (!enabled) {
          setOrderType(prev => {
            if (prev !== 'viagem') return prev;
            toast.info('A loja pausou as entregas. Modo alterado para Comer no Local.');
            return 'local';
          });
        }

        const shareImage = data.share_image;
        const storeName = data.store_name;
        if (storeName) document.title = storeName;
        if (shareImage) {
          const setMeta = (selector: string, attr: string, value: string, create: () => HTMLElement) => {
            let el = document.querySelector(selector) as HTMLElement | null;
            if (!el) { el = create(); document.head.appendChild(el); }
            el.setAttribute(attr, value);
          };
          setMeta('link[rel="icon"]', 'href', shareImage, () => { const l = document.createElement('link'); l.setAttribute('rel', 'icon'); return l; });
          setMeta('meta[property="og:image"]', 'content', shareImage, () => { const m = document.createElement('meta'); m.setAttribute('property', 'og:image'); return m; });
          setMeta('meta[name="twitter:image"]', 'content', shareImage, () => { const m = document.createElement('meta'); m.setAttribute('name', 'twitter:image'); return m; });
          setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image', () => { const m = document.createElement('meta'); m.setAttribute('name', 'twitter:card'); return m; });
          if (storeName) {
            setMeta('meta[property="og:title"]', 'content', storeName, () => { const m = document.createElement('meta'); m.setAttribute('property', 'og:title'); return m; });
          }
        }
      } catch (error) {
        if (!cancelled) console.warn('[Index] storefront config error:', error);
      }
    };

    loadStorefrontConfig();
    const pollId = window.setInterval(loadStorefrontConfig, 30000);
    return () => { cancelled = true; window.clearInterval(pollId); };
  }, [orgId]);

  useEffect(() => {
    let isMounted = true;

    const syncAuthAndRestoreOrder = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isMounted) return;

      setIsAuthenticated(Boolean(session));

      const pendingOrder = sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY);
      if (!session || !pendingOrder) return;

      try {
        const parsed = JSON.parse(pendingOrder) as PendingOrderState;
        setOrderType(parsed.orderType);
        setCart(parsed.cart || []);
        setCustomerName(parsed.customerName || '');
        setCustomerPhone(parsed.customerPhone || '');
        setDeliveryAddress(parsed.deliveryAddress || '');
        setDeliveryReference(parsed.deliveryReference || '');
        setDeliveryRecipient(parsed.deliveryRecipient || '');
        setBairroId(parsed.bairroId || '');
        setBairroNome(parsed.bairroNome || '');
        setBairroTaxa(parsed.bairroTaxa || 0);
        setBairroTempo(parsed.bairroTempo || 0);
        setDeliveryCep(parsed.deliveryCep || '');
        setCustomerCpf(parsed.customerCpf || '');
        setTableToken(parsed.tableToken || '');
        setTableLabel(parsed.tableLabel || '');
        setStep(parsed.step || 'checkout');
        toast.success('Login realizado. Continue seu pedido.');
      } catch (error) {
        console.error('Erro ao restaurar pedido pendente:', error);
      } finally {
        sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setIsAuthenticated(Boolean(session));
    });

    syncAuthAndRestoreOrder();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // A rota /cardapio/:slug só entra em modo device-owned quando o companion
  // local está enrolado para a mesma organização. O cardápio web mantém auth normal.
  useEffect(() => {
    let cancelled = false;

    if (!isPhysicalKioskRoute || !orgId) {
      setDeviceOwnedKiosk(false);
      setDeviceModeOrgId(orgId || null);
      return;
    }

    setDeviceModeOrgId(null);
    const resolveDeviceMode = async () => {
      try {
        const status = await getKioskCompanionStatus();
        if (cancelled) return;

        const deviceOwned = isDeviceOwnedKioskStatus(status, orgId);
        setDeviceOwnedKiosk(deviceOwned);

        if (deviceOwned) {
          // Storage cleanup is synchronous and remains effective even when internet is down.
          clearKioskCustomerBrowserState();
          setIsAuthenticated(false);
          // Best-effort revocation of only this browser session; device checkout never relies on it.
          void supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        } else if (status?.enrolled && status?.organization_id && status.organization_id !== orgId) {
          toast.error('Este totem está vinculado a outra loja. O modo offline por dispositivo foi bloqueado.');
        }
      } catch (error) {
        if (!cancelled) {
          setDeviceOwnedKiosk(false);
          console.warn('[Index] companion device mode unavailable:', error);
        }
      } finally {
        if (!cancelled) setDeviceModeOrgId(orgId);
      }
    };

    void resolveDeviceMode();
    return () => { cancelled = true; };
  }, [isPhysicalKioskRoute, orgId]);

  useEffect(() => {
    if (!deviceOwnedKiosk || !orgId) return;
    void warmKioskPublicData(orgId).catch((error) => {
      console.warn('[Index] kiosk public data warm-up incomplete:', error);
    });
  }, [deviceOwnedKiosk, orgId]);

  // Reseta carrinho/estado ao trocar de loja (orgId muda)
  useEffect(() => {
    if (!orgId) return;
    if (isPhysicalKioskRoute && deviceModeOrgId !== orgId) return;
    sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerCpf('');
    setDeliveryAddress('');
    setDeliveryReference('');
    setDeliveryRecipient('');
    setBairroId(''); setBairroNome(''); setBairroTaxa(0); setBairroTempo(0); setDeliveryCep('');
    setTrackingOrderId('');
    setPendingProduct(null);
    setAppliedCoupon(null);
    setScheduledFor(null);
    setPendingProduct(null);

    if (deviceOwnedKiosk) {
      clearPendingCheckout();
      setStep('landing');
      return;
    }

    const pendingCheckout = loadPendingCheckout(orgId);
    if (pendingCheckout) {
      setOrderType(pendingCheckout.orderType);
      setCart(pendingCheckout.cart || []);
      setCustomerName(pendingCheckout.customerName || '');
      setCustomerPhone(pendingCheckout.customerPhone || '');
      setCustomerCpf(pendingCheckout.customerCpf || '');
      setDeliveryAddress(pendingCheckout.deliveryAddress || '');
      setDeliveryReference(pendingCheckout.deliveryReference || '');
      setDeliveryRecipient(pendingCheckout.deliveryRecipient || '');
      setBairroId(pendingCheckout.bairroId || '');
      setBairroNome(pendingCheckout.bairroNome || '');
      setBairroTaxa(Number(pendingCheckout.bairroTaxa || 0));
      setBairroTempo(Number(pendingCheckout.bairroTempo || 0));
      setDeliveryCep(pendingCheckout.deliveryCep || '');
      setAppliedCoupon(pendingCheckout.appliedCoupon || null);
      setScheduledFor(pendingCheckout.scheduledFor || null);
      setTableToken(pendingCheckout.tableToken || '');
      setTableLabel(pendingCheckout.tableLabel || '');
      setStep('payment');
      toast.info(pendingCheckout.state === 'queued_offline'
        ? 'Pedido salvo neste dispositivo. Ele será sincronizado quando a conexão voltar.'
        : 'Recuperamos um pedido que estava sendo enviado.');
    } else {
      setStep('landing');
    }
  }, [orgId, isPhysicalKioskRoute, deviceModeOrgId, deviceOwnedKiosk]);

  useEffect(() => {
    if (!orgId) return;
    const token = (searchParams.get('mesa') || '').trim();
    if (!token) return;
    let cancelled = false;
    supabase.rpc('visionfood_public_table_context', {
      _organization_id: orgId,
      _table_token: token,
    }).then(({ data, error }) => {
      if (cancelled) return;
      const result: any = data;
      if (error || !result?.ok) {
        setTableToken('');
        setTableLabel('');
        toast.error('QR de mesa inválido ou desativado.');
        return;
      }
      setTableToken(token);
      setTableLabel(String(result.label || 'Mesa'));
      setOrderType('local');
    });
    return () => { cancelled = true; };
  }, [orgId, searchParams]);

  const addToCart = (item: CartItem) => {
    setCart(prev => [...prev, item]);
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(i => i.id !== id));
  };

  const resetOrder = () => {
    sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
    setStep('landing');
    setOrderType('local');
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerCpf('');
    setDeliveryAddress('');
    setDeliveryReference('');
    setDeliveryRecipient('');
    setBairroId(''); setBairroNome(''); setBairroTaxa(0); setBairroTempo(0); setDeliveryCep('');
    setTrackingOrderId('');
    setAppliedCoupon(null);
    setScheduledFor(null);
    setPendingProduct(null);
    if (deviceOwnedKiosk) clearKioskCustomerBrowserState();
  };

  const handlePaymentDone = (orderId?: string) => {
    if (orderId) {
      setTrackingOrderId(orderId);
      setStep('tracking');
    } else {
      resetOrder();
    }
  };

  const handleCheckout = async (sched?: string | null) => {
    setScheduledFor(sched || null);

    if (deviceOwnedKiosk) {
      setStep('checkout');
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
      setStep('checkout');
      return;
    }

    const pendingOrder: PendingOrderState = {
      step: 'checkout',
      orderType,
      cart,
      customerName,
      customerPhone,
      customerCpf,
      deliveryAddress,
      deliveryReference,
      deliveryRecipient,
      bairroId, bairroNome, bairroTaxa, bairroTempo, deliveryCep,
      tableToken, tableLabel,
    };

    sessionStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify(pendingOrder));
    toast.info('Faça login para finalizar e acompanhar seu pedido.');
    navigate(`/auth?returnTo=${encodeURIComponent(homePath)}`);
  };

  const resolvingDeviceMode = Boolean(
    isPhysicalKioskRoute && orgId && deviceModeOrgId !== orgId,
  );

  if (resolvingDeviceMode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Preparando totem...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sininho de notificações (canto superior direito) */}
      {step !== 'landing' && !deviceOwnedKiosk && (
        <div className="fixed top-3 right-3 z-50">
          <NotificationBell orgId={orgId} />
        </div>
      )}
      {step === 'landing' && <LandingScreen onStart={() => setStep(tableToken && tableLabel ? 'menu' : 'start')} />}
      {step !== 'landing' && tableToken && tableLabel && (
        <div className="fixed top-3 left-3 z-50 rounded-full bg-primary px-3 py-1.5 text-xs font-black text-primary-foreground shadow-lg">
          🍽️ {tableLabel}
        </div>
      )}
      {step === 'start' && (
        <StartScreen
          onStart={() => setStep('location')}
          onSelectProduct={(p) => { setPendingProduct(p); setStep('location'); }}
          onGoToCart={() => setStep('cart')}
          cartCount={cart.length}
          deviceOwnedKiosk={deviceOwnedKiosk}
        />
      )}
      {step === 'location' && (
        <LocationSelect deliveryEnabled={deliveryEnabled} cartCount={cart.length} onGoToCart={() => setStep('cart')} onSelect={(type) => {
          if (type === 'delivery') { setOrderType('viagem'); setStep('address'); }
          else { setOrderType(type); setStep('menu'); }
        }} onBack={() => { setPendingProduct(null); setStep('start'); }} />
      )}
      {step === 'address' && (
        <AddressSelect
          onConfirm={(addr, ref) => { setDeliveryAddress(addr); setDeliveryReference(ref); setStep('menu'); }}
          onBack={() => setStep('location')}
        />
      )}
      {step === 'menu' && (
        <MenuScreen
          cart={cart}
          onAddToCart={addToCart}
          onGoToCart={() => setStep('cart')}
          onBack={() => setStep('location')}
          initialProduct={pendingProduct}
          onInitialProductHandled={() => setPendingProduct(null)}
        />
      )}
      {step === 'cart' && (
        <CartScreen cart={cart} onRemove={removeFromCart} onCheckout={handleCheckout} onBack={() => setStep('menu')} isAuthenticated={isAuthenticated && !deviceOwnedKiosk} orgId={orgId} appliedCoupon={appliedCoupon} onApplyCoupon={setAppliedCoupon} deviceOwnedKiosk={deviceOwnedKiosk} />
      )}
      {step === 'checkout' && (
        <CheckoutScreen
          name={customerName} phone={customerPhone} cpf={customerCpf} orderType={orderType}
          deliveryAddress={deliveryAddress} deliveryReference={deliveryReference} deliveryRecipient={deliveryRecipient}
          bairroId={bairroId} deliveryCep={deliveryCep}
          onBairroChange={(id, nome, taxa, tempo) => { setBairroId(id); setBairroNome(nome); setBairroTaxa(taxa); setBairroTempo(tempo); }}
          onDeliveryCepChange={setDeliveryCep}
          onNameChange={setCustomerName} onPhoneChange={setCustomerPhone} onCpfChange={setCustomerCpf}
          onDeliveryAddressChange={setDeliveryAddress} onDeliveryReferenceChange={setDeliveryReference}
          onDeliveryRecipientChange={setDeliveryRecipient}
          onContinue={() => setStep('payment')} onBack={() => setStep('cart')}
        />
      )}
      {step === 'payment' && (
        <PaymentScreen
          cart={cart} customerName={customerName} customerPhone={customerPhone} customerCpf={customerCpf}
          orderType={orderType} deliveryAddress={deliveryAddress}
          deliveryReference={deliveryReference} deliveryRecipient={deliveryRecipient}
          bairroId={bairroId} bairroNome={bairroNome} deliveryFee={bairroTaxa} bairroTempo={bairroTempo} deliveryCep={deliveryCep}
          appliedCoupon={appliedCoupon}
          scheduledFor={scheduledFor}
          tableToken={tableToken} tableLabel={tableLabel}
          deviceOwnedKiosk={deviceOwnedKiosk}
          onBack={() => setStep('checkout')} onDone={handlePaymentDone}
        />
      )}
      {step === 'tracking' && trackingOrderId && (
        <TotemSuccess orderId={trackingOrderId} onRelease={async () => {
          if (!deviceOwnedKiosk) await supabase.auth.signOut({ scope: 'local' });
          resetOrder();
        }} />
      )}
      {step !== 'landing' && step !== 'payment' && step !== 'tracking' && (
        <PartnersFooter orgId={orgId} />
      )}
    </div>
  );
};

export default Index;
