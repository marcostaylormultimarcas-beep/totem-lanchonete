import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, CheckCircle2, Clock, Loader2, PackageCheck, Truck, UtensilsCrossed, X } from 'lucide-react';

interface OrderTrackingProps {
  orderId: string;
  onClose: () => void;
}

const STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  pending: { title: '🧾 Pedido recebido', body: 'Recebemos seu pedido! Em breve começaremos o preparo.' },
  preparing: { title: '👨‍🍳 Preparando seu pedido', body: 'Seu pedido já está sendo preparado.' },
  ready: { title: '🔔 Pedido pronto', body: 'Seu pedido ficou pronto e aguarda a próxima etapa.' },
  out_for_delivery: { title: '🚀 Saiu para entrega!', body: 'Seu pedido está a caminho. Já já chega aí!' },
  delivered: { title: '✅ Pedido entregue', body: 'Pedido entregue. Bom apetite!' },
  cancelled: { title: '❌ Pedido cancelado', body: 'Seu pedido foi cancelado.' },
};

const notifyStatus = (status: string, orderNumber: string) => {
  const msg = STATUS_MESSAGES[status];
  if (!msg) return;
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(`${msg.title} #${orderNumber}`, {
      body: msg.body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: `order-${orderNumber}`,
      renotify: true,
    } as any);
    setTimeout(() => n.close(), 8000);
  } catch (e) {
    console.warn('notify err', e);
  }
};

const ALL_STEPS = [
  { key: 'pending', label: 'Pedido Recebido', icon: Clock },
  { key: 'preparing', label: 'Preparando', icon: UtensilsCrossed },
  { key: 'ready', label: 'Pronto', icon: PackageCheck },
  { key: 'out_for_delivery', label: 'Saiu para Entrega', icon: Truck },
  { key: 'delivered', label: 'Entregue', icon: CheckCircle2 },
];

const OrderTracking = ({ orderId, onClose }: OrderTrackingProps) => {
  const [status, setStatus] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [orderType, setOrderType] = useState('');
  const [showDeliveryAlert, setShowDeliveryAlert] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    let lastStatus = '';
    let pollTimer: number | undefined;
    const channel = supabase
      .channel(`customer-order-track-${orderId}-${Math.random().toString(36).slice(2, 8)}`);

    const fetchOrder = async (initial = false) => {
      const { data, error } = await supabase.rpc('visionfood_public_order_tracking', {
        _order_id: orderId,
      });
      if (!active) return;

      const result: any = data;
      if (error || !result?.ok) {
        if (initial) setNotFound(true);
        setLoading(false);
        return;
      }

      const newStatus = String(result.status || 'pending');
      const newNumber = String(result.order_number || '');
      const changed = Boolean(lastStatus && newStatus !== lastStatus);

      setStatus(newStatus);
      setOrderNumber(newNumber);
      setOrderType(String(result.order_type || ''));

      if (changed) notifyStatus(newStatus, newNumber);

      if (changed && newStatus === 'out_for_delivery') {
        setShowDeliveryAlert(true);
        window.setTimeout(() => {
          if (active) setShowDeliveryAlert(false);
        }, 5000);
      }

      lastStatus = newStatus;
      setLoading(false);
      setNotFound(false);

      if (newStatus === 'delivered' || newStatus === 'cancelled') {
        if (pollTimer) {
          window.clearInterval(pollTimer);
          pollTimer = undefined;
        }
      }
    };

    void fetchOrder(true);

    channel
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        () => { void fetchOrder(false); },
      )
      .subscribe((realtimeStatus) => {
        if (realtimeStatus === 'CHANNEL_ERROR' || realtimeStatus === 'TIMED_OUT') {
          console.warn('[OrderTracking] realtime unavailable, polling fallback remains active:', realtimeStatus);
        }
      });

    // Fallback for anonymous tracking or mobile websocket suspension.
    pollTimer = window.setInterval(() => void fetchOrder(false), 15000);

    return () => {
      active = false;
      if (pollTimer) window.clearInterval(pollTimer);
      void supabase.removeChannel(channel);
    };
  }, [orderId]);

  const steps = useMemo(
    () => ['delivery', 'viagem'].includes(orderType)
      ? ALL_STEPS
      : ALL_STEPS.filter(step => step.key !== 'out_for_delivery'),
    [orderType],
  );

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6">
        <div className="kiosk-card p-6 max-w-sm w-full text-center space-y-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Carregando andamento do pedido...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6">
        <div className="kiosk-card p-6 max-w-sm w-full text-center space-y-4">
          <X className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-bold">Pedido não encontrado</h2>
          <p className="text-muted-foreground text-sm">O link pode estar incorreto ou o pedido já saiu da janela de acompanhamento.</p>
          <button onClick={onClose} className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl">
            Voltar ao Início
          </button>
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6">
        <div className="kiosk-card p-6 max-w-sm w-full text-center space-y-4">
          <X className="w-16 h-16 text-destructive mx-auto" />
          <h2 className="text-xl font-bold text-destructive">Pedido Cancelado</h2>
          <p className="text-muted-foreground text-sm">Infelizmente seu pedido #{orderNumber} foi cancelado.</p>
          <button onClick={onClose} className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl">
            Voltar ao Início
          </button>
        </div>
      </div>
    );
  }

  const currentIdx = steps.findIndex(s => s.key === status);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6">
      <div className="kiosk-card p-6 max-w-sm w-full space-y-6">
        <div className="flex items-center justify-between gap-3">
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Voltar para a página inicial">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-center flex-1">
            <h2 className="text-xl font-bold">Acompanhe seu Pedido</h2>
            <p className="text-primary font-black text-2xl mt-1">#{orderNumber}</p>
          </div>
          <div className="w-5" aria-hidden="true" />
        </div>

        {showDeliveryAlert && (
          <div className="bg-blue-500/20 border border-blue-500/50 rounded-xl p-3 text-center animate-pulse">
            <Truck className="w-6 h-6 text-blue-400 mx-auto mb-1" />
            <p className="text-blue-400 font-bold text-sm">🚀 Seu pedido está a caminho!</p>
          </div>
        )}

        <div className="space-y-0">
          {steps.map((step, idx) => {
            const isActive = currentIdx >= 0 && idx <= currentIdx;
            const isCurrent = idx === currentIdx;
            const StepIcon = step.icon;
            return (
              <div key={step.key} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                    isCurrent ? 'border-primary bg-primary/20 scale-110' : isActive ? 'border-success bg-success/20' : 'border-border bg-muted'
                  }`}>
                    <StepIcon className={`w-5 h-5 ${isCurrent ? 'text-primary' : isActive ? 'text-success' : 'text-muted-foreground'}`} />
                  </div>
                  {idx < steps.length - 1 && (
                    <div className={`w-0.5 h-8 transition-all duration-500 ${isActive ? 'bg-success' : 'bg-border'}`} />
                  )}
                </div>
                <div className="pt-2">
                  <p className={`font-bold text-sm ${isCurrent ? 'text-primary' : isActive ? 'text-success' : 'text-muted-foreground'}`}>
                    {step.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {status === 'delivered' && (
          <button onClick={onClose} className="touch-btn w-full bg-success text-success-foreground py-4 rounded-xl">
            ✅ Pedido Entregue! Voltar
          </button>
        )}
      </div>
    </div>
  );
};

export default OrderTracking;
