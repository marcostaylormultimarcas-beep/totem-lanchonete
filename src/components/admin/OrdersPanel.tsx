import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';
import { Clock, UtensilsCrossed, Truck, CheckCircle2, XCircle, RefreshCw, Printer, Bell, BellOff } from 'lucide-react';
import OrderPrintReceipt from './OrderPrintReceipt';
import { useOrderAlertSound } from '@/hooks/useOrderAlertSound';

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  order_type: string;
  delivery_address: string | null;
  delivery_reference: string | null;
  delivery_recipient: string | null;
  items: any[];
  total: number;
  status: string;
  created_at: string;
  nfe_status?: string;
  nfe_numero?: string;
  nfe_url?: string;
  status_reembolso?: string;
}

const REFUND_LABEL: Record<string, { label: string; cls: string }> = {
  none: { label: '', cls: '' },
  auto_eligible: { label: '💸 Reembolso automático', cls: 'bg-success/15 text-success border-success/30' },
  manual_required: { label: '⚠️ Reembolso manual (aprovar)', cls: 'bg-accent/15 text-accent border-accent/30' },
  processing: { label: '⏳ Reembolso em processamento', cls: 'bg-blue-400/15 text-blue-400 border-blue-400/30' },
  refunded: { label: '✅ Reembolsado', cls: 'bg-success/15 text-success border-success/30' },
  failed: { label: '❌ Reembolso falhou', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '⏳ Pendente', color: 'text-accent', bg: 'bg-accent/20' },
  preparing: { label: '👨‍🍳 Preparando', color: 'text-primary', bg: 'bg-primary/20' },
  out_for_delivery: { label: '🛵 Saiu p/ Entrega', color: 'text-blue-400', bg: 'bg-blue-400/20' },
  delivered: { label: '✅ Entregue', color: 'text-success', bg: 'bg-success/20' },
  cancelled: { label: '❌ Cancelado', color: 'text-destructive', bg: 'bg-destructive/20' },
};

const OrdersPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [storeName, setStoreName] = useState<string>('');

  useEffect(() => {
    if (!organizationId) { setStoreName(''); return; }
    supabase.from('settings').select('store_name').eq('organization_id', organizationId).maybeSingle()
      .then(({ data }) => setStoreName((data as any)?.store_name || ''));
  }, [organizationId]);

  const handlePrint = (order: Order) => {
    setPrintOrder(order);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          window.print();
          setTimeout(() => setPrintOrder(null), 500);
        }, 150);
      });
    });
  };

  const fetchOrders = async () => {
    if (!organizationId) { setOrders([]); return; }
    let query = supabase.from('orders').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false });
    if (filter === 'active') {
      query = query.in('status', ['pending', 'preparing', 'out_for_delivery']);
    }
    const { data } = await query.limit(50);
    if (data) setOrders(data as Order[]);
  };

  useEffect(() => {
    fetchOrders();
    if (!organizationId) return;

    const channel = supabase
      .channel('admin-orders-' + organizationId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `organization_id=eq.${organizationId}` }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [filter, organizationId]);

  const updateStatus = async (id: string, status: string, motivo?: string) => {
    const { toast } = await import('sonner');

    if (status === 'cancelled') {
      const { data, error } = await supabase.rpc('cancelar_pedido' as any, { _order_id: id, _motivo: motivo ?? null });
      const res: any = data;
      if (error) {
        console.error('cancelar_pedido', error);
        toast.error('Não foi possível cancelar o pedido.');
        return;
      }
      if (res?.ok) {
        if (res.already_cancelled) {
          toast.success('Pedido já estava cancelado.');
        } else {
          const ref = res.status_reembolso === 'auto_eligible'
            ? ' Reembolso automático elegível.'
            : res.status_reembolso === 'manual_required'
              ? ' Reembolso requer aprovação manual.'
              : '';
          toast.success('Pedido cancelado e estoque devolvido.' + ref);
        }
      } else {
        const msg: Record<string, string> = {
          forbidden: 'Sem permissão para cancelar este pedido.',
          admin_only: 'A partir do preparo, apenas o lojista pode cancelar.',
          reason_required: 'Informe um motivo (mín. 3 caracteres).',
          status_locked: 'Pedido não pode mais ser cancelado pelo cliente.',
          already_delivered: 'Pedido já entregue — não pode ser cancelado.',
          not_found: 'Pedido não encontrado.',
        };
        toast.error(msg[res?.reason] || 'Falha ao cancelar.');
      }
      return;
    }


    await supabase.from('orders').update({ status }).eq('id', id);
    if (status === 'delivered') {
      const order = orders.find(o => o.id === id);
      const { data, error } = await supabase.rpc('grant_loyalty_stamp' as any, { _order_id: id });
      const res: any = data;
      if (error) {
        console.error('grant_loyalty_stamp', error);
      } else if (res?.ok) {
        if (res.completed) {
          toast.success(`🎉 ${order?.customer_name || 'Cliente'} completou o cartão! Prêmio gerado (código ${res.codigo}).`);
        } else {
          toast.success(`+1 carimbo (${res.carimbos}/${res.meta}) para ${order?.customer_name || 'cliente'}.`);
        }
      } else if (res?.reason && !['below_minimum', 'no_phone', 'inactive', 'already_stamped'].includes(res.reason)) {
        console.warn('Carimbo não concedido:', res?.reason);
      }
    }
  };

  const hasPending = orders.some(o => o.status === 'pending');
  const { needsUnlock, muted, setMuted, unlock } = useOrderAlertSound(hasPending);

  return (
    <div className="px-4 space-y-4">
      {needsUnlock && hasPending && (
        <button
          onClick={unlock}
          className="w-full bg-accent/15 border border-accent/40 text-accent rounded-lg px-3 py-2 text-sm font-semibold animate-pulse"
        >
          🔔 Clique em qualquer lugar da tela para ativar os alertas sonoros de novos pedidos
        </button>
      )}

      <div className="flex gap-2 items-center">
        <button
          onClick={() => setMuted(m => !m)}
          className={`touch-btn px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 border ${
            muted
              ? 'bg-muted text-muted-foreground border-border'
              : hasPending
                ? 'bg-accent/20 text-accent border-accent/40 animate-pulse'
                : 'bg-foreground/5 text-foreground border-border'
          }`}
          title={muted ? 'Reativar alertas' : 'Silenciar alertas'}
        >
          {muted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          <span className="hidden sm:inline">{muted ? 'Mutado' : 'Alertas'}</span>
        </button>
        <div className="flex gap-2">
        <button
          onClick={() => setFilter('active')}
          className={`touch-btn px-4 py-2 rounded-lg text-sm ${filter === 'active' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
        >
          Ativos
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`touch-btn px-4 py-2 rounded-lg text-sm ${filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
        >
          Todos
        </button>
          <button onClick={fetchOrders} className="ml-auto p-2 text-muted-foreground hover:text-foreground">
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {orders.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Nenhum pedido {filter === 'active' ? 'ativo' : ''} encontrado</p>
        </div>
      )}

      {orders.map(order => {
        const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
        return (
          <div key={order.id} className="kiosk-card p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-primary font-black text-lg">#{order.order_number}</span>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${cfg.bg} ${cfg.color}`}>
                  {cfg.label}
                </span>
                {order.nfe_status && order.nfe_status !== 'none' && (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border flex items-center gap-1 ${
                    order.nfe_status === 'issued' ? 'bg-success/15 text-success border-success/30'
                    : order.nfe_status === 'pending' ? 'bg-accent/15 text-accent border-accent/30'
                    : 'bg-destructive/15 text-destructive border-destructive/30'
                  }`}>
                    📄 NFe {order.nfe_status === 'issued' ? `#${order.nfe_numero || '—'}` : order.nfe_status}
                  </span>
                )}
                {order.status === 'cancelled' && order.status_reembolso && order.status_reembolso !== 'none' && REFUND_LABEL[order.status_reembolso] && (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${REFUND_LABEL[order.status_reembolso].cls}`}>
                    {REFUND_LABEL[order.status_reembolso].label}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <div className="text-sm space-y-1">
              <p>👤 <span className="font-semibold">{order.customer_name}</span> — {order.customer_phone}</p>
              {order.order_type === 'local' ? (
                <p>📍 Comer no Local</p>
              ) : (
                <div className="bg-blue-400/10 border border-blue-400/30 rounded-lg p-2 space-y-0.5 mt-1">
                  <p className="text-blue-400 font-bold text-xs uppercase tracking-wide flex items-center gap-1">
                    <Truck className="w-3 h-3" /> Entrega
                  </p>
                  {order.delivery_address && <p>📌 <span className="font-semibold">Endereço:</span> {order.delivery_address}</p>}
                  {order.delivery_reference && <p>🧭 <span className="font-semibold">Referência:</span> {order.delivery_reference}</p>}
                  {order.delivery_recipient && <p>👥 <span className="font-semibold">Recebe:</span> {order.delivery_recipient}</p>}
                </div>
              )}
            </div>

            <div className="text-xs space-y-0.5 bg-muted/50 rounded-lg p-2">
              {(order.items as any[]).map((item: any, i: number) => (
                <p key={i}>{item.quantity}x {item.name} — {formatCurrency(item.total)}</p>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="font-black text-primary">{formatCurrency(order.total)}</span>
              <button
                onClick={() => handlePrint(order)}
                className="touch-btn py-2 px-3 rounded-lg text-sm bg-foreground/5 hover:bg-foreground/10 border border-border flex items-center gap-1.5 font-semibold"
              >
                <Printer className="w-4 h-4" /> Imprimir
              </button>
            </div>

            {/* Action buttons */}
            {order.status !== 'delivered' && order.status !== 'cancelled' && (
              <div className="flex gap-2 flex-wrap">
                {order.status === 'pending' && (
                  <button
                    onClick={() => updateStatus(order.id, 'preparing')}
                    className="flex-1 touch-btn py-2 rounded-lg text-sm bg-primary/20 text-primary border border-primary/30 flex items-center justify-center gap-1"
                  >
                    <UtensilsCrossed className="w-4 h-4" /> Preparando
                  </button>
                )}
                {(order.status === 'pending' || order.status === 'preparing') && (
                  <button
                    onClick={() => updateStatus(order.id, 'out_for_delivery')}
                    className="flex-1 touch-btn py-2 rounded-lg text-sm bg-blue-400/20 text-blue-400 border border-blue-400/30 flex items-center justify-center gap-1"
                  >
                    <Truck className="w-4 h-4" /> Saiu p/ Entrega
                  </button>
                )}
                {order.status !== 'delivered' && (
                  <button
                    onClick={() => updateStatus(order.id, 'delivered')}
                    className="flex-1 touch-btn py-2 rounded-lg text-sm bg-success/20 text-success border border-success/30 flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Entregue
                  </button>
                )}
                <button
                  onClick={() => {
                    const postPrep = order.status === 'preparing' || order.status === 'out_for_delivery';
                    if (postPrep) {
                      const motivo = prompt('Motivo do cancelamento (obrigatório a partir do preparo):');
                      if (!motivo || motivo.trim().length < 3) return;
                      updateStatus(order.id, 'cancelled', motivo.trim());
                    } else {
                      if (confirm('Cancelar este pedido? O estoque será devolvido.')) {
                        updateStatus(order.id, 'cancelled');
                      }
                    }
                  }}
                  className="touch-btn py-2 px-3 rounded-lg text-sm bg-destructive/20 text-destructive border border-destructive/30 flex items-center justify-center gap-1"
                  title="Cancelar pedido"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        );
      })}

      <OrderPrintReceipt order={printOrder} storeName={storeName} />
    </div>
  );
};

export default OrdersPanel;
