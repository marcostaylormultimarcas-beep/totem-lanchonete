import { getKioskHomePath } from '@/lib/kioskHome';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, Clock, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';

interface Order {
  id: string;
  order_number: string;
  total: number;
  status: string;
  created_at: string;
  items: any[];
  order_type: string;
  customer_cpf?: string;
  nfe_url?: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pendente', color: 'bg-yellow-500/20 text-yellow-400' },
  preparing: { label: 'Preparando', color: 'bg-blue-500/20 text-blue-400' },
  ready: { label: 'Pronto', color: 'bg-green-500/20 text-green-400' },
  delivered: { label: 'Entregue', color: 'bg-emerald-500/20 text-emerald-400' },
  cancelled: { label: 'Cancelado', color: 'bg-red-500/20 text-red-400' },
  out_for_delivery: { label: 'Saiu p/ Entrega', color: 'bg-purple-500/20 text-purple-400' },
};

const OrderHistory = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/auth');
        return;
      }
      setUser(session.user);

      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      setOrders((data as Order[]) || []);
      setLoading(false);
    };
    checkAuth();
  }, [navigate]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex items-center gap-4 p-4 border-b border-border">
        <button onClick={() => navigate(getKioskHomePath())} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Meus Pedidos</h1>
      </div>

      <div className="flex-1 px-4 py-4 max-w-2xl mx-auto w-full space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <Package className="w-16 h-16 text-muted-foreground/30" />
            <p className="text-muted-foreground text-lg">Nenhum pedido encontrado</p>
            <p className="text-muted-foreground/60 text-sm">Faça seu primeiro pedido!</p>
            <button onClick={() => navigate(getKioskHomePath())} className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-bold">
              Fazer Pedido
            </button>
          </div>
        ) : (
          orders.map(order => {
            const status = STATUS_MAP[order.status] || STATUS_MAP.pending;
            return (
              <div key={order.id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-primary font-black text-lg">#{order.order_number}</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${status.color}`}>{status.label}</span>
                  </div>
                  <span className="text-primary font-black text-lg">{formatCurrency(order.total)}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Clock className="w-3 h-3" />
                  <span>{formatDate(order.created_at)}</span>
                  <span className="mx-1">•</span>
                  <span>{order.order_type === 'local' ? 'No Local' : 'Entrega'}</span>
                </div>
                {Array.isArray(order.items) && order.items.length > 0 && (
                  <div className="text-sm text-muted-foreground space-y-0.5">
                    {order.items.slice(0, 3).map((item: any, i: number) => (
                      <p key={i}>{item.quantity}x {item.name}</p>
                    ))}
                    {order.items.length > 3 && <p className="text-xs">+{order.items.length - 3} itens</p>}
                  </div>
                )}
                {order.customer_cpf && (
                  <a
                    href={order.nfe_url || `/fiscal/${order.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg bg-orange-600/10 border border-orange-600/40 text-orange-400 hover:bg-orange-600/20 transition-colors"
                  >
                    <FileText className="w-4 h-4" /> Baixar Nota Fiscal
                  </a>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default OrderHistory;
