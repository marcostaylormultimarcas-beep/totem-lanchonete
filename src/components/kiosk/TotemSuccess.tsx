import QRCode from 'react-qr-code';
import { CheckCircle2 } from 'lucide-react';

interface TotemSuccessProps {
  orderId: string;
  scheduledFor?: string | null;
  onRelease: () => void;
}

const TotemSuccess = ({ orderId, scheduledFor, onRelease }: TotemSuccessProps) => {
  const trackUrl = `${window.location.origin}/acompanhar/${orderId}`;
  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
  const validScheduledDate = scheduledDate && !Number.isNaN(scheduledDate.getTime()) ? scheduledDate : null;
  const scheduledLabel = validScheduledDate
    ? validScheduledDate.toLocaleString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="kiosk-card p-8 max-w-md w-full text-center space-y-6">
        <CheckCircle2 className="w-16 h-16 text-success mx-auto" />
        <div>
          <h2 className="text-2xl font-black">{scheduledLabel ? 'Pedido Agendado!' : 'Pedido Confirmado!'}</h2>
          {scheduledLabel && (
            <p className="text-primary font-bold text-sm mt-2 capitalize">
              {scheduledLabel}
            </p>
          )}
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
