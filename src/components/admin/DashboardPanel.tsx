import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';
import { Loader2, TrendingUp, ShoppingBag, DollarSign } from 'lucide-react';

interface OrderRow {
  id: string;
  total: number;
  created_at: string;
  items: Array<{ name: string; quantity: number; total?: number; price?: number }>;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const DashboardPanel = () => {
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const fromDate = new Date(from + 'T00:00:00').toISOString();
    const toDate = new Date(to + 'T23:59:59').toISOString();
    const { data } = await supabase
      .from('orders')
      .select('id, total, created_at, items')
      .gte('created_at', fromDate)
      .lte('created_at', toDate)
      .order('created_at', { ascending: false });
    setOrders((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [from, to]);

  const stats = useMemo(() => {
    const totalRevenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
    const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
    orders.forEach(o => {
      (o.items || []).forEach(it => {
        const cur = productMap.get(it.name) || { name: it.name, quantity: 0, revenue: 0 };
        cur.quantity += Number(it.quantity || 0);
        cur.revenue += Number(it.total || (it.price || 0) * (it.quantity || 0));
        productMap.set(it.name, cur);
      });
    });
    const ranking = Array.from(productMap.values()).sort((a, b) => b.quantity - a.quantity);
    return { totalRevenue, totalOrders: orders.length, ranking };
  }, [orders]);

  const maxQty = stats.ranking[0]?.quantity || 1;

  const setPreset = (days: number) => {
    setFrom(daysAgoISO(days));
    setTo(todayISO());
  };

  return (
    <div className="px-4 space-y-4">
      {/* Filters */}
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Filtro de Período</h3>
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
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="kiosk-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center"><ShoppingBag className="w-5 h-5 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Pedidos</p>
            <p className="text-lg font-black">{stats.totalOrders}</p>
          </div>
        </div>
        <div className="kiosk-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center"><DollarSign className="w-5 h-5 text-success" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Receita</p>
            <p className="text-lg font-black text-success">{formatCurrency(stats.totalRevenue)}</p>
          </div>
        </div>
      </div>

      {/* Ranking */}
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2">🏆 Produtos Mais Vendidos</h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : stats.ranking.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-6">Nenhum pedido no período selecionado.</p>
        ) : (
          <div className="space-y-2">
            {stats.ranking.slice(0, 20).map((p, i) => (
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
