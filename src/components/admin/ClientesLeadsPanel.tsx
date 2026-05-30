import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Users, MessageCircle, Crown, Ghost, Search, TrendingUp, Calendar, DollarSign } from 'lucide-react';
import { formatCurrency } from '@/data/store';

interface Props { organizationId: string | null; storeName?: string }

interface OrderRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  total: number;
  created_at: string;
  items: any;
  status: string;
}

interface CustomerSummary {
  phone: string;
  name: string;
  orders: number;
  totalSpent: number;
  lastOrderAt: string;
  daysSince: number;
  topProduct: string;
  ordersLast30: number;
}

type FilterKey = 'all' | 'vip' | 'sumiu15' | 'sumiu30';

const normalizePhone = (raw: string) => (raw || '').replace(/\D/g, '');
const buildWaUrl = (phone: string, msg: string) => {
  let n = normalizePhone(phone);
  if (!n) return '#';
  if (n.length <= 11) n = '55' + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
};

const formatPhone = (raw: string) => {
  const n = normalizePhone(raw);
  if (n.length === 11) return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return raw || '-';
};

const ClientesLeadsPanel = ({ organizationId, storeName }: Props) => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [vipMinSpend, setVipMinSpend] = useState(200);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!organizationId) { setOrders([]); setLoading(false); return; }
    setLoading(true);
    supabase.from('orders')
      .select('id, customer_name, customer_phone, total, created_at, items, status')
      .eq('organization_id', organizationId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(2000)
      .then(({ data }) => {
        setOrders((data as OrderRow[]) || []);
        setLoading(false);
      });
  }, [organizationId]);

  const customers = useMemo<CustomerSummary[]>(() => {
    const now = Date.now();
    const map = new Map<string, CustomerSummary & { productCounts: Map<string, number> }>();
    for (const o of orders) {
      const phone = normalizePhone(o.customer_phone);
      if (!phone || phone.length < 8) continue;
      let entry = map.get(phone);
      if (!entry) {
        entry = {
          phone,
          name: o.customer_name || 'Sem nome',
          orders: 0,
          totalSpent: 0,
          lastOrderAt: o.created_at,
          daysSince: 0,
          topProduct: '-',
          ordersLast30: 0,
          productCounts: new Map(),
        };
        map.set(phone, entry);
      }
      entry.orders += 1;
      entry.totalSpent += Number(o.total) || 0;
      const created = new Date(o.created_at);
      if (created > new Date(entry.lastOrderAt)) {
        entry.lastOrderAt = o.created_at;
        if (o.customer_name) entry.name = o.customer_name;
      }
      const daysAgo = (now - created.getTime()) / 86400000;
      if (daysAgo <= 30) entry.ordersLast30 += 1;
      // items can be array of { name, quantity }
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        const name = it?.name || it?.product_name;
        if (!name) continue;
        const qty = Number(it?.quantity) || 1;
        entry.productCounts.set(name, (entry.productCounts.get(name) || 0) + qty);
      }
    }
    const list: CustomerSummary[] = [];
    for (const c of map.values()) {
      let top = '-'; let topQty = 0;
      for (const [name, q] of c.productCounts.entries()) {
        if (q > topQty) { top = name; topQty = q; }
      }
      const daysSince = Math.floor((now - new Date(c.lastOrderAt).getTime()) / 86400000);
      list.push({
        phone: c.phone,
        name: c.name,
        orders: c.orders,
        totalSpent: c.totalSpent,
        lastOrderAt: c.lastOrderAt,
        daysSince,
        topProduct: top,
        ordersLast30: c.ordersLast30,
      });
    }
    return list.sort((a, b) => b.totalSpent - a.totalSpent);
  }, [orders]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.filter(c => {
      if (filter === 'vip' && !(c.totalSpent >= vipMinSpend || c.ordersLast30 >= 3)) return false;
      if (filter === 'sumiu15' && c.daysSince < 15) return false;
      if (filter === 'sumiu30' && c.daysSince < 30) return false;
      if (term) {
        const hay = `${c.name} ${c.phone}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [customers, filter, vipMinSpend, search]);

  const stats = useMemo(() => {
    const totalClientes = customers.length;
    const totalGasto = customers.reduce((s, c) => s + c.totalSpent, 0);
    const vips = customers.filter(c => c.totalSpent >= vipMinSpend || c.ordersLast30 >= 3).length;
    const sumiram = customers.filter(c => c.daysSince >= 15).length;
    return { totalClientes, totalGasto, vips, sumiram };
  }, [customers, vipMinSpend]);

  const waMessageFor = (c: CustomerSummary) => {
    const store = storeName || 'nossa loja';
    if (c.daysSince >= 15) {
      return `Olá ${c.name}! Sentimos sua falta na ${store} 💛. Que tal voltar com um cupom especial? Estamos te esperando!`;
    }
    if (c.totalSpent >= vipMinSpend || c.ordersLast30 >= 3) {
      return `Olá ${c.name}! Aqui é da ${store}. Como cliente VIP, preparamos uma surpresa exclusiva pra você 👑.`;
    }
    return `Olá ${c.name}! Aqui é da ${store}, tudo bem?`;
  };

  if (!organizationId) {
    return <div className="kiosk-card p-6 text-zinc-400">Selecione uma loja.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-yellow-600/10 border border-amber-500/30 flex items-center justify-center">
          <Users className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold bg-gradient-to-r from-amber-300 to-yellow-500 bg-clip-text text-transparent">
            Gestão de Clientes e Leads
          </h2>
          <p className="text-xs text-zinc-500">CRM local com inteligência de consumo</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Clientes', value: stats.totalClientes, icon: Users, color: 'text-amber-300' },
          { label: 'Receita total', value: formatCurrency(stats.totalGasto), icon: DollarSign, color: 'text-emerald-400' },
          { label: 'Clientes VIP', value: stats.vips, icon: Crown, color: 'text-yellow-400' },
          { label: 'Sumiram (15d+)', value: stats.sumiram, icon: Ghost, color: 'text-rose-400' },
        ].map((k) => (
          <div key={k.label} className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">{k.label}</span>
              <k.icon className={`w-4 h-4 ${k.color}`} />
            </div>
            <div className={`mt-2 text-2xl font-bold ${k.color}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {([
            { k: 'all', label: 'Todos', icon: Users },
            { k: 'vip', label: 'Clientes VIP', icon: Crown },
            { k: 'sumiu15', label: 'Sumiu 15+ dias', icon: Ghost },
            { k: 'sumiu30', label: 'Sumiu 30+ dias', icon: Ghost },
          ] as const).map((f) => {
            const active = filter === f.k;
            return (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border transition-all ${
                  active
                    ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-zinc-950 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.3)]'
                    : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-amber-500/40'
                }`}
              >
                <f.icon className="w-3.5 h-3.5" />
                {f.label}
              </button>
            );
          })}
          {filter === 'vip' && (
            <label className="ml-2 inline-flex items-center gap-2 text-xs text-zinc-400">
              Gasto mínimo
              <input
                type="number"
                min={0}
                value={vipMinSpend}
                onChange={(e) => setVipMinSpend(Number(e.target.value) || 0)}
                className="w-24 px-2 py-1 rounded-md bg-zinc-950 border border-zinc-800 text-amber-300 font-bold focus:border-amber-500 outline-none"
              />
            </label>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 focus:border-amber-500/60 outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 overflow-hidden">
        {loading ? (
          <div className="p-10 flex items-center justify-center text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando inteligência...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-zinc-500 text-sm">Nenhum cliente neste filtro.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950/80 border-b border-zinc-800">
                <tr className="text-left text-[11px] uppercase tracking-wider text-amber-300/80">
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">WhatsApp</th>
                  <th className="px-4 py-3">Mais pedido</th>
                  <th className="px-4 py-3 text-right">Pedidos</th>
                  <th className="px-4 py-3 text-right">Total gasto</th>
                  <th className="px-4 py-3">Última compra</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const isVip = c.totalSpent >= vipMinSpend || c.ordersLast30 >= 3;
                  const sumiu = c.daysSince >= 15;
                  return (
                    <tr key={c.phone} className="border-b border-zinc-800/60 hover:bg-zinc-950/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-zinc-100">{c.name}</span>
                          {isVip && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
                              <Crown className="w-3 h-3" /> VIP
                            </span>
                          )}
                          {sumiu && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                              Sumiu {c.daysSince}d
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{formatPhone(c.phone)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-zinc-300">
                          <TrendingUp className="w-3 h-3 text-amber-400" />
                          {c.topProduct}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-300 font-semibold">{c.orders}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 font-bold">{formatCurrency(c.totalSpent)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-zinc-400 text-xs">
                          <Calendar className="w-3 h-3" />
                          {new Date(c.lastOrderAt).toLocaleDateString('pt-BR')}
                          <span className="text-zinc-600">· {c.daysSince}d</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={buildWaUrl(c.phone, waMessageFor(c))}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors text-xs font-semibold"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          WhatsApp
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500">
          Exibindo {filtered.length} de {customers.length} clientes
        </div>
      </div>
    </div>
  );
};

export default ClientesLeadsPanel;
