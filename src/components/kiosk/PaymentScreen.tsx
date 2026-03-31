import { useState } from 'react';
import { ArrowLeft, Copy, Check, MessageCircle, CheckCircle2, Ticket } from 'lucide-react';
import { CartItem, getItemTotal, formatCurrency, getSettings, getNextOrderNumber } from '@/data/store';

interface PaymentScreenProps {
  cart: CartItem[];
  customerName: string;
  customerPhone: string;
  orderType: 'local' | 'viagem';
  deliveryAddress?: string;
  deliveryReference?: string;
  deliveryRecipient?: string;
  onBack: () => void;
  onDone: () => void;
}

const PIX_KEY = 'pagamento@visionmidia.com';
const QR_URL = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=PagamentoVisionMidia';

const PaymentScreen = ({ cart, customerName, customerPhone, orderType, deliveryAddress, deliveryReference, deliveryRecipient, onBack, onDone }: PaymentScreenProps) => {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [generatedNumber, setGeneratedNumber] = useState('');
  const total = cart.reduce((sum, item) => sum + getItemTotal(item), 0);

  const handleCopy = () => {
    navigator.clipboard.writeText(PIX_KEY);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buildWhatsAppMessage = () => {
    const settings = getSettings();
    let msg = `🧾 *NOVO PEDIDO - ${settings.storeName || 'Vision Mídia'}*\n\n`;
    msg += `🔢 *SENHA DO PEDIDO: #${generatedNumber}*\n\n`;
    msg += `👤 *CLIENTE:* ${customerName} - ${customerPhone}\n`;
    msg += `📍 *LOCAL:* ${orderType === 'local' ? 'Comer no Local (Mesa)' : 'Para Viagem (Entrega)'}\n`;

    if (orderType === 'viagem' && deliveryAddress) {
      msg += `🏠 *ENDEREÇO:* ${deliveryAddress}\n`;
      if (deliveryReference) msg += `📌 *REFERÊNCIA:* ${deliveryReference}\n`;
      if (deliveryRecipient) msg += `👤 *RECEBEDOR:* ${deliveryRecipient}\n`;
    }

    msg += `\n📋 *PEDIDO:*\n`;
    msg += `─────────────────\n`;

    cart.forEach((item, i) => {
      msg += `${i + 1}. ${item.quantity}x ${item.product.name} — ${formatCurrency(getItemTotal(item))}\n`;
      if (item.removedIngredients.length > 0) {
        msg += `   ❌ Sem: ${item.removedIngredients.join(', ')}\n`;
      }
      if (item.selectedExtras.length > 0) {
        msg += `   ✅ Extras: ${item.selectedExtras.map(e => `${e.name} (+${formatCurrency(e.price)})`).join(', ')}\n`;
      }
    });

    msg += `─────────────────\n`;
    msg += `💳 *PAGAMENTO:* Pix - Aguardando Conferência\n`;
    msg += `💰 *TOTAL: ${formatCurrency(total)}*`;

    return encodeURIComponent(msg);
  };

  const handleSendToKitchen = () => {
    const settings = getSettings();
    const whatsappUrl = `https://wa.me/${settings.whatsappNumber}?text=${buildWhatsAppMessage()}`;
    window.open(whatsappUrl, '_blank');
    onDone();
  };

  const handleConfirmPayment = () => {
    const num = getNextOrderNumber();
    setGeneratedNumber(num);
    setConfirmed(true);
  };

  // Success / Summary screen after confirming payment
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

        {/* Order Summary */}
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
              {deliveryReference && <p className="text-xs text-muted-foreground">📌 Ref: {deliveryReference}</p>}
              {deliveryRecipient && <p className="text-xs text-muted-foreground">👤 Recebedor: {deliveryRecipient}</p>}
            </div>
          )}
          <hr className="border-border" />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">📋 Pedido</p>
            {cart.map((item, i) => (
              <div key={item.id} className="text-sm space-y-0.5">
                <p className="font-semibold">{i + 1}. {item.quantity}x {item.product.name} — {formatCurrency(getItemTotal(item))}</p>
                {item.removedIngredients.length > 0 && (
                  <p className="text-destructive text-xs">❌ Sem: {item.removedIngredients.join(', ')}</p>
                )}
                {item.selectedExtras.length > 0 && (
                  <p className="text-success text-xs">✅ Extras: {item.selectedExtras.map(e => e.name).join(', ')}</p>
                )}
              </div>
            ))}
          </div>
          <hr className="border-border" />
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">💳 Pagamento</span>
            <span className="font-semibold text-sm">Pix — Aguardando Conferência</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-bold text-lg">TOTAL</span>
            <span className="font-black text-xl text-primary">{formatCurrency(total)}</span>
          </div>
        </div>

        <button
          onClick={handleSendToKitchen}
          className="touch-btn w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3"
        >
          <MessageCircle className="w-7 h-7" />
          ENVIAR PEDIDO PARA A COZINHA
        </button>
      </div>
    );
  }

  // PIX payment screen
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex items-center gap-4 p-4 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-7 h-7" />
        </button>
        <h2 className="text-xl font-bold">Pagamento <span className="text-primary">PIX</span></h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 max-w-md mx-auto">
        <p className="text-muted-foreground text-sm">Escaneie o QR Code ou copie a chave</p>

        <div className="bg-foreground rounded-2xl p-4">
          <img src={QR_URL} alt="QR Code PIX" width={250} height={250} className="rounded-lg" />
        </div>

        <div className="w-full">
          <p className="text-sm text-muted-foreground text-center mb-2">Chave PIX (copia e cola):</p>
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 bg-muted px-4 py-3 rounded-xl transition-all active:scale-95"
          >
            {copied ? <Check className="w-5 h-5 text-success" /> : <Copy className="w-5 h-5 text-muted-foreground" />}
            <span className="font-mono text-sm">{PIX_KEY}</span>
          </button>
        </div>

        <div className="text-center">
          <p className="text-2xl font-black text-primary">{formatCurrency(total)}</p>
        </div>

        <button
          onClick={handleConfirmPayment}
          className="touch-btn w-full bg-success text-success-foreground py-5 rounded-xl text-xl flex items-center justify-center gap-3"
        >
          <Check className="w-6 h-6" />
          Já Realizei o Pagamento
        </button>
      </div>
    </div>
  );
};

export default PaymentScreen;
