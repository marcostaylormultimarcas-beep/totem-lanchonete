import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';
import {
  Loader2, TrendingUp, ShoppingBag, ShoppingCart, DollarSign, Package, Users,
  Plus, ClipboardList, LayoutGrid, BarChart3, FileText, ArrowRight, AlertTriangle, PackageX, Clock,
} from 'lucide-react';

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
  pending: { label: 'Pendente', cls: 'bg-amber-500/15 text-amber-400' },
  preparing: { label: 'Preparando', cls: 'bg-[#FF7A00]/15 text-[#FF7A00]' },
  out_for_delivery: { label: 'Entrega', cls: 'bg-blue-400/15 text-blue-400' },
  delivered: { label: 'Entregue', cls: 'bg-emerald-500/15 text-emerald-400' },
  ready: { label: 'Pronto', cls: 'bg-emerald-500/15 text-emerald-400' },
  cancelled: { label: 'Cancelado', cls: 'bg-red-500/15 text-red-400' },
};

type DashboardPanelProps = {
  organizationId: string | null;
  onNavigate?: (tab: string) => void;
};

const DashboardPanel = ({ organizationId, onNavigate }: DashboardPanelProps) => {
  const navigate = useNavigate();
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [periodOrders, setPeriodOrders] = useState<OrderRow[]>([]);
  const [todayOrders, setTodayOrders] = useState<OrderRow[]>([]);
  const [recentOrders, setRecentOrders] = useState<OrderRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockProduct[]>([]);
  const [productCount, setProductCount] = useState<number>(0);
  const [customerCount, setCustomerCount] = useState<number>(0);
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
      setTodayOrders([]); setRecentOrders([]); setLowStock([]); setProductCount(0); setCustomerCount(0);
      return;
    }
    setLoading(true);
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

    const [{ data: today }, { data: recent }, { data: products }, prodCount, custCount] = await Promise.all([
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
        .limit(6),
      (supabase.from('products') as any)
        .select('id, name, stock_quantity, low_stock_threshold, manage_stock')
        .eq('organization_id', organizationId)
        .eq('manage_stock', true),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
      (supabase.from('profiles') as any).select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
    ]);

    setTodayOrders((today as any) || []);
    setRecentOrders((recent as any) || []);
    const low = ((products as any[]) || []).filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold));
    low.sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity));
    setLowStock(low);
    setProductCount(prodCount.count || 0);
    setCustomerCount(custCount.count || 0);
    setLoading(false);
  };

  useEffect(() => { loadOverview(); }, [organizationId]);
  useEffect(() => { loadPeriod(); }, [from, to, organizationId]);

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

  const goTab = (t: string) => { onNavigate ? onNavigate(t) : null; };

  // KPI mini card
  const Kpi = ({ label, value, hint, hintTone = 'muted', icon: Icon, iconBg }: {
    label: string; value: string; hint?: string; hintTone?: 'muted' | 'positive' | 'accent';
    icon: any; iconBg: string;
  }) => (
    <div className="relative p-4 rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden">
      <div className="flex items-start justify-between mb-3">
        <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider">{label}</p>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconBg}`}>
          <Icon className="w-4 h-4" strokeWidth={2.2} />
        </div>
      </div>
      <h3 className="text-2xl font-bold text-white leading-none">{value}</h3>
      {hint && (
        <p className={`text-[10px] font-medium mt-2 ${
          hintTone === 'positive' ? 'text-emerald-400' :
          hintTone === 'accent' ? 'text-[#FF7A00]' : 'text-zinc-500'
        }`}>{hint}</p>
      )}
    </div>
  );

  const quickActions = [
    { key: 'np', label: 'Novo Produto', icon: Plus, accent: true, onClick: () => goTab('products') },
    { key: 'pdv', label: 'Novo Pedido', icon: ShoppingCart, onClick: () => navigate('/pdv') },
    { key: 'cat', label: 'Categorias', icon: LayoutGrid, onClick: () => goTab('products') },
    { key: 'rel', label: 'Relatórios', icon: BarChart3, onClick: () => goTab('financeiro') },
  ];

  return (
    <div className="px-5 pt-6 pb-32 space-y-6">
      {/* Section heading */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white">Visão geral</h2>
        <span className="text-[11px] text-zinc-500 font-medium">
          Hoje, {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}
        </span>
      </div>

      {/* === KPIs grid (Pedidos, Faturamento, Produtos, Clientes) === */}
      <div className="grid grid-cols-2 gap-3">
        <Kpi
          label="Pedidos"
          value={String(todayOrders.length)}
          hint="Hoje"
          hintTone="accent"
          icon={ShoppingBag}
          iconBg="bg-[#FF7A00]/15 text-[#FF7A00]"
        />
        <Kpi
          label="Faturamento"
          value={formatCurrency(todayRevenue)}
          hint="Hoje"
          hintTone="positive"
          icon={DollarSign}
          iconBg="bg-emerald-500/15 text-emerald-400"
        />
        <Kpi
          label="Produtos"
          value={String(productCount)}
          hint={lowStock.length > 0 ? `${lowStock.length} em baixa` : 'Cadastrados'}
          hintTone={lowStock.length > 0 ? 'accent' : 'muted'}
          icon={Package}
          iconBg="bg-blue-500/15 text-blue-400"
        />
        <Kpi
          label="Clientes"
          value={String(customerCount)}
          hint="Cadastrados"
          icon={Users}
          iconBg="bg-violet-500/15 text-violet-400"
        />
      </div>

      {/* === Recent orders === */}
      <div className="p-5 rounded-[20px] bg-white/[0.04] border border-white/10 backdrop-blur-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white">Pedidos recentes</h3>
          <button
            onClick={() => goTab('orders')}
            className="text-xs text-[#FF7A00] font-bold uppercase tracking-wide flex items-center gap-1 hover:opacity-80"
          >
            Ver todos <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-[#FF7A00]" />
            <p className="text-xs text-zinc-500">Carregando…</p>
          </div>
        ) : recentOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4 shadow-inner">
              <FileText className="w-6 h-6 text-[#FF7A00]" strokeWidth={1.8} />
            </div>
            <p className="text-sm font-semibold text-white">Nenhum pedido encontrado</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-[240px]">
              Novas vendas aparecerão aqui em tempo real.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {recentOrders.map(o => {
              const cfg = STATUS_BADGE[o.status] || STATUS_BADGE.pending;
              return (
                <div key={o.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate">
                      <span className="text-[#FF7A00]">#{o.order_number}</span> · {o.customer_name}
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      {new Date(o.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${cfg.cls}`}>{cfg.label}</span>
                  <span className="text-xs font-bold text-emerald-400 whitespace-nowrap">{formatCurrency(Number(o.total || 0))}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* === Quick actions === */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3 ml-1">Ações rápidas</h3>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map(a => {
            const Icon = a.icon;
            return (
              <button
                key={a.key}
                onClick={a.onClick}
                className="flex items-center gap-3 p-4 rounded-2xl bg-white/[0.04] border border-white/10 text-left transition-all duration-200 active:scale-[0.97] hover:bg-white/[0.07] hover:border-white/20"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  a.accent ? 'bg-[#FF7A00]/15' : 'bg-white/5'
                }`}>
                  <Icon className={`w-5 h-5 ${a.accent ? 'text-[#FF7A00]' : 'text-white'}`} strokeWidth={2.2} />
                </div>
                <span className="text-xs font-bold text-white">{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* === Low stock (compact) === */}
      {lowStock.length > 0 && (
        <div className="p-5 rounded-[20px] bg-white/[0.04] border border-white/10">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#FF7A00]" /> Produtos em baixa
          </h3>
          <div className="divide-y divide-white/[0.05]">
            {lowStock.slice(0, 6).map(p => (
              <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate flex-1 text-zinc-200">{p.name}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  p.stock_quantity <= 0 ? 'bg-red-500/15 text-red-400' : 'bg-[#FF7A00]/15 text-[#FF7A00]'
                }`}>
                  {p.stock_quantity <= 0 ? 'Esgotado' : `${p.stock_quantity} restante${p.stock_quantity !== 1 ? 's' : ''}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === Período + Ranking (mantido, restilizado) === */}
      <div className="p-5 rounded-[20px] bg-white/[0.04] border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#FF7A00]" /> Relatório por período
          </h3>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            { d: 0, l: 'Hoje' }, { d: 7, l: '7 dias' }, { d: 30, l: '30 dias' }, { d: 90, l: '90 dias' },
          ].map(p => (
            <button
              key={p.l}
              onClick={() => setPreset(p.d)}
              className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-[11px] font-semibold text-zinc-300 hover:border-[#FF7A00]/40 hover:text-white transition-colors"
            >
              {p.l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-zinc-500 mb-1 block uppercase tracking-wider font-bold">De</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl outline-none focus:border-[#FF7A00]/60 focus:ring-2 focus:ring-[#FF7A00]/20 text-sm text-white" />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 mb-1 block uppercase tracking-wider font-bold">Até</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl outline-none focus:border-[#FF7A00]/60 focus:ring-2 focus:ring-[#FF7A00]/20 text-sm text-white" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#FF7A00]/15 flex items-center justify-center"><ShoppingBag className="w-4 h-4 text-[#FF7A00]" /></div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase font-bold">Pedidos</p>
              <p className="text-base font-bold text-white">{periodStats.totalOrders}</p>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center"><DollarSign className="w-4 h-4 text-emerald-400" /></div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase font-bold">Receita</p>
              <p className="text-base font-bold text-emerald-400">{formatCurrency(periodStats.totalRevenue)}</p>
            </div>
          </div>
        </div>
      </div>

      {periodStats.ranking.length > 0 && (
        <div className="p-5 rounded-[20px] bg-white/[0.04] border border-white/10 space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">🏆 Mais vendidos no período</h3>
          <div className="space-y-2.5">
            {periodStats.ranking.slice(0, 10).map((p, i) => (
              <div key={p.name} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-white truncate flex-1">
                    <span className="text-[#FF7A00] mr-1.5 font-black">#{i + 1}</span>{p.name}
                  </span>
                  <span className="text-zinc-400 ml-2 whitespace-nowrap">
                    {p.quantity}x · <span className="text-emerald-400">{formatCurrency(p.revenue)}</span>
                  </span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[#FF7A00] to-[#FF9D42]" style={{ width: `${(p.quantity / maxQty) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPanel;
