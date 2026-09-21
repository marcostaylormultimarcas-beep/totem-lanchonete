import { getKioskHomePath } from '@/lib/kioskHome';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, Clock, FileText, LogOut } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SUPABASE_AUTH_STORAGE_KEY } from '@/config/supabaseConfig';
import { formatCurrency } from '@/data/store';
import { toast } from 'sonner';

const withTimeout = <T,>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });

const resolveInitialAuthSession = (ms = 5000): Promise<any> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let timer: number | undefined;
    let subscription: { unsubscribe: () => void } | null = null;

    const finish = (session: any, error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      subscription?.unsubscribe();
      if (error) reject(error);
      else resolve(session);
    };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === 'INITIAL_SESSION' ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'SIGNED_OUT'
      ) {
        finish(session);
      }
    });

    subscription = data.subscription;
    if (settled) subscription.unsubscribe();

    timer = window.setTimeout(
      () => finish(null, new Error('auth_session_timeout')),
      ms,
    );
  });

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
  delivery_code?: string;
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
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollTimer: number | undefined;

    const loadOrders = async (initial = false) => {
      if (initial) {
        setLoading(true);
        setLoadError('');
      }

      try {
        const { data, error } = await withTimeout(
          supabase.rpc('visionfood_my_orders' as any, { _limit: 50 }),
          10000,
          'order_history_timeout',
        );

        if (cancelled) return;
        if (error) throw error;
        setOrders((Array.isArray(data) ? data : []) as Order[]);
        setLoadError('');
      } catch (error) {
        if (cancelled) return;
        console.error('[OrderHistory] load failed', error);
        if (initial) setOrders([]);
        setLoadError('Não foi possível carregar seus pedidos agora. Tente novamente.');
      } finally {
        if (initial && !cancelled) setLoading(false);
      }
    };

    const checkAuth = async () => {
      setLoading(true);
      setLoadError('');

      try {
        const session = await resolveInitialAuthSession();

        if (cancelled) return;
        if (!session) {
          navigate('/auth');
          return;
        }

        const userId = session.user.id;
        setUser(session.user);
        await loadOrders(true);
        if (cancelled) return;

        channel = supabase
          .channel(`customer-orders-${userId}-${Math.random().toString(36).slice(2, 8)}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
            () => { void loadOrders(false); },
          )
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.warn('[OrderHistory] realtime unavailable, polling fallback remains active:', status);
            }
          });

        // Safety net for mobile networks that suspend or drop the websocket.
        pollTimer = window.setInterval(() => { void loadOrders(false); }, 15000);
      } catch (error) {
        if (cancelled) return;
        console.error('[OrderHistory] auth/load failed', error);
        setOrders([]);
        setLoadError('Não foi possível carregar seus pedidos agora. Verifique a conexão e tente novamente.');
        setLoading(false);
      }
    };

    void checkAuth();
    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [navigate, retryKey]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);

    try {
      const { error } = await withTimeout(
        supabase.auth.signOut({ scope: 'local' }),
        5000,
        'auth_signout_timeout',
      );
      if (error) throw error;
    } catch (error) {
      console.warn('[OrderHistory] local sign-out stalled/failed; clearing this project auth storage before reload:', error);
      try {
        Object.keys(localStorage)
          .filter((key) => key === SUPABASE_AUTH_STORAGE_KEY || key.startsWith(`${SUPABASE_AUTH_STORAGE_KEY}-`))
          .forEach((key) => localStorage.removeItem(key));
      } catch {
        // Full reload below still prevents this screen from keeping stale auth state in memory.
      }
    }

    toast.success('Você saiu da sua conta.');
    window.location.replace(getKioskHomePath());
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex items-center justify-between gap-4 p-4 border-b border-border">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(getKioskHomePath())} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">Meus Pedidos</h1>
        </div>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted text-muted-foreground hover:text-foreground text-sm font-semibold transition disabled:opacity-60 disabled:cursor-wait"
        >
          <LogOut className="w-4 h-4" /> {loggingOut ? 'Saindo…' : 'Sair'}
        </button>
      </div>

      <div className="flex-1 px-4 py-4 max-w-2xl mx-auto w-full space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <Package className="w-16 h-16 text-destructive/40" />
            <p className="text-destructive font-bold">Não foi possível carregar seus pedidos</p>
            <p className="text-muted-foreground text-sm max-w-sm">{loadError}</p>
            <button
              onClick={() => {
                setLoading(true);
                setLoadError('');
                setRetryKey(key => key + 1);
              }}
              className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-bold"
            >
              Tentar novamente
            </button>
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
                {(order.order_type === 'delivery' || order.order_type === 'viagem') && order.delivery_code && order.status !== 'delivered' && order.status !== 'cancelled' && (
                  <div className="bg-orange-600/10 border border-orange-600/40 rounded-xl p-3">
                    <p className="text-[11px] uppercase tracking-wider text-orange-400/80 font-bold mb-1">🔐 Código de entrega</p>
                    <p className="text-orange-400 font-black text-3xl tracking-[0.4em] text-center">{order.delivery_code}</p>
                    <p className="text-[11px] text-muted-foreground text-center mt-1">Informe ao entregador apenas ao receber o pedido</p>
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
