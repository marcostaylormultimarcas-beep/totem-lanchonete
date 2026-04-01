import { useState } from 'react';
import StartScreen from '@/components/kiosk/StartScreen';
import LocationSelect from '@/components/kiosk/LocationSelect';
import MenuScreen from '@/components/kiosk/MenuScreen';
import CartScreen from '@/components/kiosk/CartScreen';
import CheckoutScreen from '@/components/kiosk/CheckoutScreen';
import PaymentScreen from '@/components/kiosk/PaymentScreen';
import { CartItem } from '@/data/store';

type Step = 'start' | 'location' | 'menu' | 'cart' | 'checkout' | 'payment';

const Index = () => {
  const [step, setStep] = useState<Step>('start');
  const [orderType, setOrderType] = useState<'local' | 'viagem'>('local');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryReference, setDeliveryReference] = useState('');
  const [deliveryRecipient, setDeliveryRecipient] = useState('');

  const addToCart = (item: CartItem) => {
    setCart(prev => [...prev, item]);
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(i => i.id !== id));
  };

  const resetOrder = () => {
    setStep('start');
    setOrderType('local');
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setDeliveryReference('');
    setDeliveryRecipient('');
  };

  return (
    <div className="min-h-screen bg-background max-w-[1200px] mx-auto">
      {step === 'start' && <StartScreen onStart={() => setStep('location')} />}
      {step === 'location' && (
        <LocationSelect
          onSelect={(type) => { setOrderType(type); setStep('menu'); }}
          onBack={() => setStep('start')}
        />
      )}
      {step === 'menu' && (
        <MenuScreen
          cart={cart}
          onAddToCart={addToCart}
          onGoToCart={() => setStep('cart')}
          onBack={() => setStep('location')}
        />
      )}
      {step === 'cart' && (
        <CartScreen
          cart={cart}
          onRemove={removeFromCart}
          onCheckout={() => setStep('checkout')}
          onBack={() => setStep('menu')}
        />
      )}
      {step === 'checkout' && (
        <CheckoutScreen
          name={customerName}
          phone={customerPhone}
          orderType={orderType}
          deliveryAddress={deliveryAddress}
          deliveryReference={deliveryReference}
          deliveryRecipient={deliveryRecipient}
          onNameChange={setCustomerName}
          onPhoneChange={setCustomerPhone}
          onDeliveryAddressChange={setDeliveryAddress}
          onDeliveryReferenceChange={setDeliveryReference}
          onDeliveryRecipientChange={setDeliveryRecipient}
          onContinue={() => setStep('payment')}
          onBack={() => setStep('cart')}
        />
      )}
      {step === 'payment' && (
        <PaymentScreen
          cart={cart}
          customerName={customerName}
          customerPhone={customerPhone}
          orderType={orderType}
          deliveryAddress={deliveryAddress}
          deliveryReference={deliveryReference}
          deliveryRecipient={deliveryRecipient}
          onBack={() => setStep('checkout')}
          onDone={resetOrder}
        />
      )}
    </div>
  );
};

export default Index;
