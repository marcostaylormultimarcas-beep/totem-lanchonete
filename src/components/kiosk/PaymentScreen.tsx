import { useState, useEffect } from 'react';
import { ArrowLeft, Copy, Check, MessageCircle, CheckCircle2, Ticket } from 'lucide-react';
import { CartItem, getItemTotal, formatCurrency, StoreSettings } from '@/data/store';
import { supabase } from '@/integrations/supabase/client';

interface PaymentScreenProps {
  cart: CartItem[];
  customerName: string;
  customerPhone: string;
  orderType: 'local' | 'viagem';
  deliveryAddress?: string;
  deliveryReference?: string;
  deliveryRecipient?: string;
  onBack: () => void;
  onDone: (orderId?: string) => void;
}

const PIX_KEY = 'pagamento@visionmidia.com';
const QR_URL = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=PagamentoVisionMidia';

const PaymentScreen = ({ cart, customerName, customerPhone, orderType, deliveryAddress, deliveryReference, deliveryRecipient, onBack, onDone }: PaymentScreenProps) => {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [generatedNumber, setGeneratedNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [storeSettings, setStoreSettings] = useState<{ storeName: string; whatsappNumber: string }>({ storeName: 'Vision Mídia', whatsappNumber: '' });
  const total = cart.reduce((sum, item) => sum + getItemTotal(item), 0);

  useEffect(() => {
    const fetchSettings = async () => {
      const { data } = await supabase.from('settings').select('store_name, whatsapp_number').limit(1).maybeSingle();
      if (data) {
        setStoreSettings({ storeName: data.store_name || 'Vision Mídia', whatsappNumber: data.whatsapp_number || '' });
      }
    };
    fetchSettings();
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(PIX_KEY);
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
    msg += `─────────────────\n💳 *PAGAMENTO:* Pix - Aguardando Conferência\n💰 *TOTAL: ${formatCurrency(total)}*`;
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
      // Get next order number from DB count
      const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
      const num = ((count || 0) + 1).toString().padStart(3, '0');
      setGeneratedNumber(num);

      const orderItems = cart.map(item => ({
        name: item.product.name,
        quantity: item.quantity,
        price: item.product.price,
        total: getItemTotal(item),
        removedIngredients: item.removedIngredients,
        extras: item.selectedExtras.map(e => e.name),
      }));

      const { data, error } = await supabase.from('orders').insert({
        order_number: num,
        customer_name: customerName,
        customer_phone: customerPhone,
        order_type: orderType,
        delivery_address: deliveryAddress || '',
        delivery_reference: deliveryReference || '',
        delivery_recipient: deliveryRecipient || '',
        items: orderItems,
        total,
        status: 'pending',
      }).select('id').single();

      if (error) throw error;
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
          <div className="flex justify-between items-center">
            <span className="font-bold text-lg">TOTAL</span>
            <span className="font-black text-xl text-primary">{formatCurrency(total)}</span>
          </div>
        </div>

        <button onClick={handleSendToKitchen} className="touch-btn w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3">
          <MessageCircle className="w-7 h-7" /> ENVIAR PEDIDO PARA A COZINHA
        </button>

        {currentOrderId && (
          <button onClick={() => onDone(currentOrderId)} className="touch-btn w-full bg-muted text-foreground py-4 rounded-xl text-lg flex items-center justify-center gap-2">
            📍 Acompanhar Pedido
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex items-center gap-4 p-4 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-7 h-7" /></button>
        <h2 className="text-xl font-bold">Pagamento <span className="text-primary">PIX</span></h2>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 max-w-md mx-auto">
        <p className="text-muted-foreground text-sm">Escaneie o QR Code ou copie a chave</p>
        <div className="bg-foreground rounded-2xl p-4">
          <img src={QR_URL} alt="QR Code PIX" width={250} height={250} className="rounded-lg" />
        </div>
        <div className="w-full">
          <p className="text-sm text-muted-foreground text-center mb-2">Chave PIX (copia e cola):</p>
          <button onClick={handleCopy} className="w-full flex items-center justify-center gap-2 bg-muted px-4 py-3 rounded-xl transition-all active:scale-95">
            {copied ? <Check className="w-5 h-5 text-success" /> : <Copy className="w-5 h-5 text-muted-foreground" />}
            <span className="font-mono text-sm">{PIX_KEY}</span>
          </button>
        </div>
        <div className="text-center"><p className="text-2xl font-black text-primary">{formatCurrency(total)}</p></div>
        <button onClick={handleConfirmPayment} disabled={saving} className="touch-btn w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3 disabled:opacity-50">
          <Check className="w-6 h-6" /> {saving ? 'Salvando...' : 'Já Realizei o Pagamento'}
        </button>
      </div>
    </div>
  );
};

export default PaymentScreen;
