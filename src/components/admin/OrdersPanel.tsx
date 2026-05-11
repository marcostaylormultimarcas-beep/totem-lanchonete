import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';
import { Clock, UtensilsCrossed, Truck, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

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
}

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

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('orders').update({ status }).eq('id', id);
  };

  return (
    <div className="px-4 space-y-4">
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
            <div className="flex items-center justify-between">
              <div>
                <span className="text-primary font-black text-lg">#{order.order_number}</span>
                <span className={`ml-2 text-xs font-bold px-2 py-1 rounded-full ${cfg.bg} ${cfg.color}`}>
                  {cfg.label}
                </span>
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

            <div className="flex items-center justify-between">
              <span className="font-black text-primary">{formatCurrency(order.total)}</span>
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
                  onClick={() => { if (confirm('Cancelar este pedido?')) updateStatus(order.id, 'cancelled'); }}
                  className="touch-btn py-2 px-3 rounded-lg text-sm bg-destructive/20 text-destructive border border-destructive/30 flex items-center justify-center gap-1"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default OrdersPanel;
