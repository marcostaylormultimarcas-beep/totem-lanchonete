import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useOrgId } from '@/contexts/OrgContext';
import StartScreen from '@/components/kiosk/StartScreen';
import LocationSelect from '@/components/kiosk/LocationSelect';
import MenuScreen from '@/components/kiosk/MenuScreen';
import CartScreen from '@/components/kiosk/CartScreen';
import CheckoutScreen from '@/components/kiosk/CheckoutScreen';
import PaymentScreen from '@/components/kiosk/PaymentScreen';
import TotemSuccess from '@/components/kiosk/TotemSuccess';
import LandingScreen from '@/components/kiosk/LandingScreen';
import { CartItem, Product } from '@/data/store';
import type { AppliedCoupon } from '@/components/kiosk/CartScreen';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Step = 'landing' | 'start' | 'location' | 'menu' | 'cart' | 'checkout' | 'payment' | 'tracking';

const PENDING_ORDER_STORAGE_KEY = 'pending-kiosk-order';

interface PendingOrderState {
  step: Step;
  orderType: 'local' | 'viagem';
  cart: CartItem[];
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryReference: string;
  deliveryRecipient: string;
}

const Index = () => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const orgId = useOrgId();
  const homePath = slug ? `/loja/${slug}` : '/';
  const [step, setStep] = useState<Step>('landing');
  const [orderType, setOrderType] = useState<'local' | 'viagem'>('local');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryReference, setDeliveryReference] = useState('');
  const [deliveryRecipient, setDeliveryRecipient] = useState('');
  const [trackingOrderId, setTrackingOrderId] = useState('');
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);

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

  // Reseta carrinho/estado ao trocar de loja (orgId muda)
  useEffect(() => {
    if (!orgId) return;
    sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setDeliveryReference('');
    setDeliveryRecipient('');
    setTrackingOrderId('');
    setPendingProduct(null);
    setAppliedCoupon(null);
    setStep('landing');
  }, [orgId]);

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
    setDeliveryAddress('');
    setDeliveryReference('');
    setDeliveryRecipient('');
    setTrackingOrderId('');
  };

  const handlePaymentDone = (orderId?: string) => {
    if (orderId) {
      setTrackingOrderId(orderId);
      setStep('tracking');
    } else {
      resetOrder();
    }
  };

  const handleCheckout = async () => {
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
      deliveryAddress,
      deliveryReference,
      deliveryRecipient,
    };

    sessionStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify(pendingOrder));
    toast.info('Faça login para finalizar e acompanhar seu pedido.');
    navigate(`/auth?returnTo=${encodeURIComponent(homePath)}`);
  };

  return (
    <div className="min-h-screen bg-background">
      {step === 'landing' && <LandingScreen onStart={() => setStep('start')} />}
      {step === 'start' && (
        <StartScreen
          onStart={() => setStep('location')}
          onSelectProduct={(p) => { setPendingProduct(p); setStep('location'); }}
          onGoToCart={() => setStep('cart')}
          cartCount={cart.length}
        />
      )}
      {step === 'location' && (
        <LocationSelect onSelect={(type) => { setOrderType(type); setStep('menu'); }} onBack={() => { setPendingProduct(null); setStep('start'); }} />
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
        <CartScreen cart={cart} onRemove={removeFromCart} onCheckout={handleCheckout} onBack={() => setStep('menu')} isAuthenticated={isAuthenticated} />
      )}
      {step === 'checkout' && (
        <CheckoutScreen
          name={customerName} phone={customerPhone} orderType={orderType}
          deliveryAddress={deliveryAddress} deliveryReference={deliveryReference} deliveryRecipient={deliveryRecipient}
          onNameChange={setCustomerName} onPhoneChange={setCustomerPhone}
          onDeliveryAddressChange={setDeliveryAddress} onDeliveryReferenceChange={setDeliveryReference}
          onDeliveryRecipientChange={setDeliveryRecipient}
          onContinue={() => setStep('payment')} onBack={() => setStep('cart')}
        />
      )}
      {step === 'payment' && (
        <PaymentScreen
          cart={cart} customerName={customerName} customerPhone={customerPhone}
          orderType={orderType} deliveryAddress={deliveryAddress}
          deliveryReference={deliveryReference} deliveryRecipient={deliveryRecipient}
          onBack={() => setStep('checkout')} onDone={handlePaymentDone}
        />
      )}
      {step === 'tracking' && trackingOrderId && (
        <TotemSuccess orderId={trackingOrderId} onRelease={async () => {
          await supabase.auth.signOut();
          resetOrder();
        }} />
      )}
    </div>
  );
};

export default Index;
