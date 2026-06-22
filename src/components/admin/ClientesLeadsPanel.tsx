import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Users, MessageCircle, Search, TrendingUp, Calendar, DollarSign, ShoppingBag, Target } from 'lucide-react';
import { formatCurrency } from '@/data/store';
import { BRAND_NAME } from '@/config/brandConfig';

interface Props { organizationId: string | null; storeName?: string }

interface OrderRow {
  id: string;
  user_id: string | null;
  customer_name: string;
  customer_phone: string;
  total: number;
  created_at: string;
  items: any;
  status: string;
}

interface CustomerSummary {
  key: string;
  phone: string;
  name: string;
  email: string;
  orders: number;
  totalSpent: number;
  lastOrderAt: string | null;
  daysSince: number | null;
  topProduct: string;
  isLead: boolean;
  source: string;
}

type FilterKey = 'all' | 'clientes' | 'leads';

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

const fallbackContactUrl = (msg: string) => `https://wa.me/?text=${encodeURIComponent(msg)}`;

const ClientesLeadsPanel = ({ organizationId, storeName }: Props) => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [profileContacts, setProfileContacts] = useState<Array<{ key: string; userId: string; email: string; phone: string; name: string; source: string; created_at: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!organizationId) { setOrders([]); setProfileContacts([]); setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    (async () => {
      const [profilesRes, ordersRes] = await Promise.all([
        supabase.from('profiles')
          .select('user_id, display_name, email, phone, created_at, origem_assinatura_empresa_id')
          .eq('origem_assinatura_empresa_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(5000),
        supabase.from('orders')
          .select('id, user_id, customer_name, customer_phone, total, created_at, items, status')
          .eq('organization_id', organizationId)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(5000),
      ]);

      const errors = [profilesRes.error, ordersRes.error].filter(Boolean);
      if (errors.length) {
        console.error('[ClientesLeadsPanel] load failed', errors);
        setLoadError('Não foi possível carregar clientes/leads. Verifique as permissões da loja e tente atualizar.');
      }

      setOrders((ordersRes.data as OrderRow[]) || []);
      setProfileContacts(((profilesRes.data || []) as any[]).map((p) => ({
        key: `profile:${p.user_id}`,
        userId: p.user_id,
        email: p.email || '',
        phone: normalizePhone(p.phone || ''),
        name: p.display_name || 'Lead sem nome',
        source: 'Cadastro',
        created_at: p.created_at,
      })));
      setLoading(false);
    })();
  }, [organizationId]);

  const customers = useMemo<CustomerSummary[]>(() => {
    const now = Date.now();
    const map = new Map<string, CustomerSummary & { productCounts: Map<string, number> }>();
    const keyByUserId = new Map(profileContacts.map((p) => [p.userId, p.key]));
    const keyByPhone = new Map(profileContacts.filter((p) => p.phone.length >= 8).map((p) => [p.phone, p.key]));

    for (const p of profileContacts) {
      map.set(p.key, {
        key: p.key,
        phone: p.phone,
        name: p.name,
        email: p.email,
        orders: 0,
        totalSpent: 0,
        lastOrderAt: null,
        daysSince: null,
        topProduct: '-',
        isLead: true,
        source: p.source,
        productCounts: new Map(),
      });
    }

    for (const o of orders) {
      const phone = normalizePhone(o.customer_phone);
      const key = (o.user_id && keyByUserId.get(o.user_id)) || keyByPhone.get(phone) || (phone.length >= 8 ? phone : `order:${o.id}`);
      let entry = map.get(key);
      if (!entry) {
        entry = {
          key,
          phone,
          email: '',
          name: o.customer_name || 'Sem nome',
          orders: 0,
          totalSpent: 0,
          lastOrderAt: o.created_at,
          daysSince: 0,
          topProduct: '-',
          isLead: false,
          source: 'Pedidos',
          productCounts: new Map(),
        };
        map.set(key, entry);
      }
      entry.isLead = false;
      entry.source = entry.source === 'Cadastro' ? 'Cadastro + Pedidos' : 'Pedidos';
      if (!entry.phone && phone) entry.phone = phone;
      entry.orders += 1;
      entry.totalSpent += Number(o.total) || 0;
      const created = new Date(o.created_at);
      if (!entry.lastOrderAt || created > new Date(entry.lastOrderAt)) {
        entry.lastOrderAt = o.created_at;
        if (o.customer_name) entry.name = o.customer_name;
      }
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
      const daysSince = c.lastOrderAt ? Math.floor((now - new Date(c.lastOrderAt).getTime()) / 86400000) : null;
      list.push({
        key: c.key,
        phone: c.phone,
        name: c.name,
        email: c.email,
        orders: c.orders,
        totalSpent: c.totalSpent,
        lastOrderAt: c.lastOrderAt,
        daysSince,
        topProduct: top,
        isLead: c.isLead,
        source: c.source,
      });
    }
    return list.sort((a, b) => {
      if (a.isLead !== b.isLead) return a.isLead ? 1 : -1;
      return b.totalSpent - a.totalSpent;
    });
  }, [orders, profileContacts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.filter(c => {
      if (filter === 'clientes' && c.isLead) return false;
      if (filter === 'leads' && !c.isLead) return false;
      if (term) {
        const hay = `${c.name} ${c.email} ${c.phone}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [customers, filter, search]);

  const stats = useMemo(() => {
    const clientes = customers.filter(c => !c.isLead).length;
    const leads = customers.filter(c => c.isLead).length;
    const totalGasto = customers.reduce((s, c) => s + c.totalSpent, 0);
    return { clientes, leads, totalGasto, total: customers.length };
  }, [customers]);

  const waMessageFor = (c: CustomerSummary) => {
    const store = storeName || BRAND_NAME;
    if (c.isLead) {
      return `Olá ${c.name !== 'Lead sem nome' ? c.name : ''}! 👋 Aqui é da ${store}. Vimos que você se interessou pelo nosso cardápio e queremos te dar um cupom especial de boas-vindas pra você experimentar 🍔✨. Quer aproveitar?`;
    }
    return `Olá ${c.name}! Aqui é da ${store}, tudo bem? Preparamos uma novidade pra você 💛`;
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
            Clientes e Leads
          </h2>
          <p className="text-xs text-zinc-500">Captura de leads + base ativa de compradores</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total contatos', value: stats.total, icon: Users, color: 'text-amber-300' },
          { label: 'Clientes ativos', value: stats.clientes, icon: ShoppingBag, color: 'text-emerald-400' },
          { label: 'Novos leads', value: stats.leads, icon: Target, color: 'text-amber-400' },
          { label: 'Receita total', value: formatCurrency(stats.totalGasto), icon: DollarSign, color: 'text-emerald-400' },
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
        {loadError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {loadError}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {([
            { k: 'all', label: 'Todos', icon: Users },
            { k: 'clientes', label: 'Apenas Clientes', icon: ShoppingBag },
            { k: 'leads', label: 'Apenas Leads', icon: Target },
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
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando contatos...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-zinc-500 text-sm">Nenhum contato neste filtro.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950/80 border-b border-zinc-800">
                <tr className="text-left text-[11px] uppercase tracking-wider text-amber-300/80">
                  <th className="px-4 py-3">Contato</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">WhatsApp</th>
                  <th className="px-4 py-3">Mais pedido</th>
                  <th className="px-4 py-3 text-right">Pedidos</th>
                  <th className="px-4 py-3 text-right">Total gasto</th>
                  <th className="px-4 py-3">Última atividade</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.key} className="border-b border-zinc-800/60 hover:bg-zinc-950/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-100">{c.name}</div>
                      {c.email && <div className="text-[10px] text-zinc-500">{c.email}</div>}
                      <div className="text-[10px] text-zinc-500">Origem: {c.source}</div>
                    </td>
                    <td className="px-4 py-3">
                      {c.isLead ? (
                        <span className="px-2 py-1 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1">
                          🎯 Novo Lead
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                          🛍️ Cliente Ativo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-2">
                        <span className="text-zinc-400 font-mono text-xs">{formatPhone(c.phone)}</span>
                        <a
                          href={c.phone ? buildWaUrl(c.phone, waMessageFor(c)) : fallbackContactUrl(waMessageFor(c))}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir WhatsApp"
                          className="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 inline-flex items-center justify-center transition-colors"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-zinc-300">
                        <TrendingUp className="w-3 h-3 text-amber-400" />
                        {c.topProduct}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-300 font-semibold">{c.orders}</td>
                    <td className="px-4 py-3 text-right text-emerald-400 font-bold">{formatCurrency(c.totalSpent)}</td>
                    <td className="px-4 py-3">
                      {c.lastOrderAt ? (
                        <span className="inline-flex items-center gap-1 text-zinc-400 text-xs">
                          <Calendar className="w-3 h-3" />
                          {new Date(c.lastOrderAt).toLocaleDateString('pt-BR')}
                          <span className="text-zinc-600">· {c.daysSince}d</span>
                        </span>
                      ) : (
                        <span className="text-zinc-600 text-xs italic">aguardando 1ª compra</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={c.phone ? buildWaUrl(c.phone, waMessageFor(c)) : fallbackContactUrl(waMessageFor(c))}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                          c.isLead
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25'
                            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                        }`}
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        {c.isLead ? 'Converter' : 'WhatsApp'}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500">
          Exibindo {filtered.length} de {customers.length} contatos ({stats.clientes} clientes · {stats.leads} leads)
        </div>
      </div>
    </div>
  );
};

export default ClientesLeadsPanel;
