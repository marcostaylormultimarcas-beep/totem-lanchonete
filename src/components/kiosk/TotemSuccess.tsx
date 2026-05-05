import QRCode from 'react-qr-code';
import { CheckCircle2 } from 'lucide-react';

interface TotemSuccessProps {
  orderId: string;
  onRelease: () => void;
}

const TotemSuccess = ({ orderId, onRelease }: TotemSuccessProps) => {
  const trackUrl = `${window.location.origin}/acompanhar/${orderId}`;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="kiosk-card p-8 max-w-md w-full text-center space-y-6">
        <CheckCircle2 className="w-16 h-16 text-success mx-auto" />
        <div>
          <h2 className="text-2xl font-black">Pedido Confirmado!</h2>
          <p className="text-muted-foreground text-sm mt-2">
            Escaneie para acompanhar seu pedido no celular
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl mx-auto inline-block">
          <QRCode value={trackUrl} size={240} />
        </div>

        <p className="text-xs text-muted-foreground break-all">{trackUrl}</p>

        <button
          onClick={onRelease}
          className="touch-btn w-full bg-primary text-primary-foreground py-5 rounded-xl text-lg font-bold"
        >
          Liberar Totem (Voltar ao Início)
        </button>
      </div>
    </div>
  );
};

export default TotemSuccess;
