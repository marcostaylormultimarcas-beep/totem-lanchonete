import { ArrowLeft, User, Phone, MapPin, Navigation, UserCheck, FileText } from 'lucide-react';
import { maskCpf, isValidCpf } from '@/lib/cpf';

interface CheckoutScreenProps {
  name: string;
  phone: string;
  cpf: string;
  orderType: 'local' | 'viagem';
  deliveryAddress: string;
  deliveryReference: string;
  deliveryRecipient: string;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onCpfChange: (v: string) => void;
  onDeliveryAddressChange: (v: string) => void;
  onDeliveryReferenceChange: (v: string) => void;
  onDeliveryRecipientChange: (v: string) => void;
  onContinue: () => void;
  onBack: () => void;
}

const CheckoutScreen = ({
  name, phone, cpf, orderType,
  deliveryAddress, deliveryReference, deliveryRecipient,
  onNameChange, onPhoneChange, onCpfChange,
  onDeliveryAddressChange, onDeliveryReferenceChange, onDeliveryRecipientChange,
  onContinue, onBack,
}: CheckoutScreenProps) => {
  const baseValid = name.trim().length >= 2 && phone.trim().length >= 8;
  const cpfValid = !cpf || isValidCpf(cpf);
  const deliveryValid = orderType === 'viagem' ? deliveryAddress.trim().length >= 5 && deliveryRecipient.trim().length >= 2 : true;
  const isValid = baseValid && deliveryValid && cpfValid;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex items-center gap-4 p-4 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-7 h-7" />
        </button>
        <h2 className="text-xl font-bold">Seus Dados</h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 max-w-md mx-auto w-full py-6">
        <div className="text-center space-y-2">
          <span className="text-5xl">👤</span>
          <h3 className="text-2xl font-bold">Quase lá!</h3>
          <p className="text-muted-foreground">Informe seus dados para o pedido</p>
        </div>

        <div className="w-full space-y-4">
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Seu nome"
              value={name}
              onChange={e => onNameChange(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary transition-all"
              maxLength={100}
            />
          </div>
          <div className="relative">
            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="tel"
              placeholder="Seu telefone"
              value={phone}
              onChange={e => onPhoneChange(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary transition-all"
              maxLength={20}
            />
          </div>

          <div className="relative">
            <FileText className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              inputMode="numeric"
              placeholder="CPF na Nota (opcional)"
              value={cpf}
              onChange={e => onCpfChange(maskCpf(e.target.value))}
              className={`w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 transition-all ${cpf && !cpfValid ? 'ring-2 ring-destructive' : 'focus:ring-primary'}`}
              maxLength={14}
            />
            {cpf && !cpfValid && (
              <p className="text-destructive text-xs mt-1 ml-1">CPF inválido</p>
            )}
            {!cpf && (
              <p className="text-muted-foreground text-[11px] mt-1 ml-1">Preencha para receber a Nota Fiscal vinculada ao pedido</p>
            )}
          </div>


          {orderType === 'viagem' && (
            <>
              <hr className="border-border" />
              <p className="text-sm font-bold text-primary flex items-center gap-2">
                <MapPin className="w-4 h-4" /> Dados de Entrega
              </p>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Endereço completo"
                  value={deliveryAddress}
                  onChange={e => onDeliveryAddressChange(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary transition-all"
                  maxLength={200}
                />
              </div>
              <div className="relative">
                <Navigation className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Ponto de referência (opcional)"
                  value={deliveryReference}
                  onChange={e => onDeliveryReferenceChange(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary transition-all"
                  maxLength={200}
                />
              </div>
              <div className="relative">
                <UserCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Nome de quem vai receber"
                  value={deliveryRecipient}
                  onChange={e => onDeliveryRecipientChange(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary transition-all"
                  maxLength={100}
                />
              </div>
            </>
          )}
        </div>

        <button
          onClick={onContinue}
          disabled={!isValid}
          className={`touch-btn w-full py-4 rounded-xl text-lg ${
            isValid ? 'bg-primary text-primary-foreground cta-breath' : 'bg-muted text-muted-foreground cursor-not-allowed'
          }`}
        >
          Ir para Pagamento
        </button>
      </div>
    </div>
  );
};

export default CheckoutScreen;
