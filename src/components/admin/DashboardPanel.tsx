import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';
import { Loader2, TrendingUp, ShoppingBag, DollarSign, PackageX, Clock, AlertTriangle } from 'lucide-react';

interface OrderRow {
  id: string;
  order_number: string;
  customer_name: string;
  total: number;
  status: string;
  created_at: string;
  items: Array<{ name: string; quantity: number; total?: number; price?: number }>;
}

interface LowStockProduct {
  id: string;
  name: string;
  stock_quantity: number;
  low_stock_threshold: number;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendente', cls: 'bg-accent/20 text-accent' },
  preparing: { label: 'Preparando', cls: 'bg-primary/20 text-primary' },
  out_for_delivery: { label: 'Entrega', cls: 'bg-blue-400/20 text-blue-400' },
  delivered: { label: 'Entregue', cls: 'bg-success/20 text-success' },
  cancelled: { label: 'Cancelado', cls: 'bg-destructive/20 text-destructive' },
};

const DashboardPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [periodOrders, setPeriodOrders] = useState<OrderRow[]>([]);
  const [todayOrders, setTodayOrders] = useState<OrderRow[]>([]);
  const [recentOrders, setRecentOrders] = useState<OrderRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockProduct[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPeriod = async () => {
    if (!organizationId) { setPeriodOrders([]); return; }
    const fromDate = new Date(from + 'T00:00:00').toISOString();
    const toDate = new Date(to + 'T23:59:59').toISOString();
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, total, status, created_at, items')
      .eq('organization_id', organizationId)
      .gte('created_at', fromDate)
      .lte('created_at', toDate)
      .order('created_at', { ascending: false });
    setPeriodOrders((data as any) || []);
  };

  const loadOverview = async () => {
    if (!organizationId) {
      setTodayOrders([]); setRecentOrders([]); setLowStock([]);
      return;
    }
    setLoading(true);
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

    const [{ data: today }, { data: recent }, { data: products }] = await Promise.all([
      supabase.from('orders')
        .select('id, order_number, customer_name, total, status, created_at, items')
        .eq('organization_id', organizationId)
        .gte('created_at', startOfToday.toISOString())
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false }),
      supabase.from('orders')
        .select('id, order_number, customer_name, total, status, created_at, items')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase.from('products')
        .select('id, name, stock_quantity, low_stock_threshold, manage_stock')
        .eq('organization_id', organizationId)
        .eq('manage_stock' as any, true),
    ]);

    setTodayOrders((today as any) || []);
    setRecentOrders((recent as any) || []);
    const low = ((products as any[]) || []).filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold));
    low.sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity));
    setLowStock(low);
    setLoading(false);
  };

  useEffect(() => { loadOverview(); }, [organizationId]);
  useEffect(() => { loadPeriod(); }, [from, to, organizationId]);

  // Realtime: refresh overview when orders or products change
  useEffect(() => {
    if (!organizationId) return;
    const ch = supabase
      .channel('overview-' + organizationId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `organization_id=eq.${organizationId}` }, () => loadOverview())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `organization_id=eq.${organizationId}` }, () => loadOverview())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [organizationId]);

  const todayRevenue = useMemo(
    () => todayOrders.reduce((s, o) => s + Number(o.total || 0), 0),
    [todayOrders]
  );

  const periodStats = useMemo(() => {
    const totalRevenue = periodOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
    periodOrders.forEach(o => {
      (o.items || []).forEach(it => {
        const cur = productMap.get(it.name) || { name: it.name, quantity: 0, revenue: 0 };
        cur.quantity += Number(it.quantity || 0);
        cur.revenue += Number(it.total || (it.price || 0) * (it.quantity || 0));
        productMap.set(it.name, cur);
      });
    });
    const ranking = Array.from(productMap.values()).sort((a, b) => b.quantity - a.quantity);
    return { totalRevenue, totalOrders: periodOrders.length, ranking };
  }, [periodOrders]);

  const maxQty = periodStats.ranking[0]?.quantity || 1;
  const setPreset = (days: number) => { setFrom(daysAgoISO(days)); setTo(todayISO()); };

  return (
    <div className="px-4 space-y-4">
      {/* === VISÃO GERAL CARDS === */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Vendas Hoje */}
        <div className="kiosk-card p-4 space-y-2 border-l-4 border-success">
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
            <DollarSign className="w-4 h-4 text-success" /> Vendas (Hoje)
          </div>
          <p className="text-2xl font-black text-success">{formatCurrency(todayRevenue)}</p>
          <p className="text-xs text-muted-foreground">{todayOrders.length} pedido{todayOrders.length !== 1 ? 's' : ''} confirmado{todayOrders.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Baixo Estoque */}
        <div className={`kiosk-card p-4 space-y-2 border-l-4 ${lowStock.length ? 'border-accent' : 'border-muted'}`}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
            <PackageX className={`w-4 h-4 ${lowStock.length ? 'text-accent' : 'text-muted-foreground'}`} /> Baixo Estoque
          </div>
          <p className={`text-2xl font-black ${lowStock.length ? 'text-accent' : 'text-foreground'}`}>{lowStock.length}</p>
          <p className="text-xs text-muted-foreground">produto{lowStock.length !== 1 ? 's' : ''} precisa{lowStock.length === 1 ? '' : 'm'} reposição</p>
        </div>

        {/* Últimos Pedidos */}
        <div className="kiosk-card p-4 space-y-2 border-l-4 border-primary">
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
            <Clock className="w-4 h-4 text-primary" /> Últimos Pedidos
          </div>
          <p className="text-2xl font-black text-primary">{recentOrders.length}</p>
          <p className="text-xs text-muted-foreground">visíveis abaixo</p>
        </div>
      </div>

      {/* Low Stock List */}
      {lowStock.length > 0 && (
        <div className="kiosk-card p-4 space-y-2">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-accent" /> Produtos em Baixa
          </h3>
          <div className="space-y-1">
            {lowStock.slice(0, 8).map(p => (
              <div key={p.id} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                <span className="truncate flex-1">{p.name}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.stock_quantity <= 0 ? 'bg-destructive/20 text-destructive' : 'bg-accent/20 text-accent'}`}>
                  {p.stock_quantity <= 0 ? 'Esgotado' : `${p.stock_quantity} restante${p.stock_quantity !== 1 ? 's' : ''}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Orders */}
      <div className="kiosk-card p-4 space-y-2">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" /> Últimos Pedidos
        </h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : recentOrders.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">Nenhum pedido ainda.</p>
        ) : (
          <div className="space-y-1">
            {recentOrders.map(o => {
              const cfg = STATUS_BADGE[o.status] || STATUS_BADGE.pending;
              return (
                <div key={o.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0 gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-primary text-xs">#{o.order_number} · <span className="text-foreground truncate">{o.customer_name}</span></p>
                    <p className="text-[11px] text-muted-foreground">{new Date(o.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${cfg.cls}`}>{cfg.label}</span>
                  <span className="font-bold text-success whitespace-nowrap">{formatCurrency(Number(o.total || 0))}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* === RELATÓRIO POR PERÍODO === */}
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Relatório por Período</h3>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setPreset(0)} className="px-3 py-2 rounded-lg bg-muted text-xs hover:bg-primary hover:text-primary-foreground">Hoje</button>
          <button onClick={() => setPreset(7)} className="px-3 py-2 rounded-lg bg-muted text-xs hover:bg-primary hover:text-primary-foreground">7 dias</button>
          <button onClick={() => setPreset(30)} className="px-3 py-2 rounded-lg bg-muted text-xs hover:bg-primary hover:text-primary-foreground">30 dias</button>
          <button onClick={() => setPreset(90)} className="px-3 py-2 rounded-lg bg-muted text-xs hover:bg-primary hover:text-primary-foreground">90 dias</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">De</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Até</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="kiosk-card p-3 flex items-center gap-3 bg-background/40">
            <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center"><ShoppingBag className="w-4 h-4 text-primary" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Pedidos</p>
              <p className="text-base font-black">{periodStats.totalOrders}</p>
            </div>
          </div>
          <div className="kiosk-card p-3 flex items-center gap-3 bg-background/40">
            <div className="w-9 h-9 rounded-full bg-success/20 flex items-center justify-center"><DollarSign className="w-4 h-4 text-success" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Receita</p>
              <p className="text-base font-black text-success">{formatCurrency(periodStats.totalRevenue)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Ranking */}
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2">🏆 Produtos Mais Vendidos (período)</h3>
        {periodStats.ranking.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-6">Nenhum pedido no período selecionado.</p>
        ) : (
          <div className="space-y-2">
            {periodStats.ranking.slice(0, 20).map((p, i) => (
              <div key={p.name} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold truncate flex-1">
                    <span className="text-primary mr-1 font-black">#{i + 1}</span> {p.name}
                  </span>
                  <span className="text-muted-foreground ml-2 whitespace-nowrap">
                    {p.quantity}x · <span className="text-success">{formatCurrency(p.revenue)}</span>
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-primary to-secondary" style={{ width: `${(p.quantity / maxQty) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPanel;
