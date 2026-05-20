import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Users, MessageCircle, Sparkles, Phone, Search, Calendar } from 'lucide-react';
import { toast } from 'sonner';

interface Props { organizationId: string | null; storeName?: string }

interface OrderRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  total: number;
  created_at: string;
  status: string;
}

interface CustomerSummary {
  phone: string;
  name: string;
  orders: number;
  totalSpent: number;
  lastOrderAt: string;
  lastOrderTotal: number;
  daysSince: number;
}

const OBJETIVOS = [
  { key: 'recuperar', label: 'Recuperar cliente inativo' },
  { key: 'promocao', label: 'Anunciar promoção' },
  { key: 'novidade', label: 'Apresentar novidade' },
  { key: 'aniversario', label: 'Aniversário do cliente' },
  { key: 'feedback', label: 'Pedir feedback' },
];

const normalizePhone = (raw: string) => (raw || '').replace(/\D/g, '');
const buildWaUrl = (phone: string, msg: string) => {
  let n = normalizePhone(phone);
  if (!n) return '#';
  if (n.length <= 11) n = '55' + n; // BR default
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
};

const CrmPanel = ({ organizationId, storeName }: Props) => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [daysInactive, setDaysInactive] = useState(15);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CustomerSummary | null>(null);
  const [objetivo, setObjetivo] = useState('recuperar');
  const [extras, setExtras] = useState('');
  const [message, setMessage] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!organizationId) { setOrders([]); setLoading(false); return; }
    setLoading(true);
    supabase.from('orders')
      .select('id, customer_name, customer_phone, total, created_at, status')
      .eq('organization_id', organizationId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1000)
      .then(({ data }) => {
        setOrders((data as OrderRow[]) || []);
        setLoading(false);
      });
  }, [organizationId]);

  const customers = useMemo<CustomerSummary[]>(() => {
    const map = new Map<string, CustomerSummary>();
    for (const o of orders) {
      const phone = normalizePhone(o.customer_phone);
      if (!phone || phone.length < 8) continue;
      const existing = map.get(phone);
      const created = new Date(o.created_at);
      if (existing) {
        existing.orders += 1;
        existing.totalSpent += Number(o.total) || 0;
        if (created > new Date(existing.lastOrderAt)) {
          existing.lastOrderAt = o.created_at;
          existing.lastOrderTotal = Number(o.total) || 0;
          existing.name = o.customer_name || existing.name;
        }
      } else {
        map.set(phone, {
          phone,
          name: o.customer_name || 'Cliente',
          orders: 1,
          totalSpent: Number(o.total) || 0,
          lastOrderAt: o.created_at,
          lastOrderTotal: Number(o.total) || 0,
          daysSince: 0,
        });
      }
    }
    const now = Date.now();
    const list = Array.from(map.values()).map(c => ({
      ...c,
      daysSince: Math.floor((now - new Date(c.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24)),
    }));
    return list.sort((a, b) => b.daysSince - a.daysSince);
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter(c =>
      c.daysSince >= daysInactive &&
      (!q || c.name.toLowerCase().includes(q) || c.phone.includes(q))
    );
  }, [customers, daysInactive, search]);

  const openCustomer = (c: CustomerSummary) => {
    setSelected(c);
    setMessage('');
    setExtras('');
    setObjetivo('recuperar');
  };

  const generate = async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('crm-generate-message', {
        body: {
          objetivo,
          cliente: selected.name,
          loja: storeName || '',
          dias_inativo: selected.daysSince,
          ultimo_pedido_total: selected.lastOrderTotal,
          extras: extras || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setMessage((data as any)?.message || '');
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao gerar mensagem');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="px-4 space-y-4">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        <h2 className="font-bold text-base">CRM — Marketing de Retenção</h2>
      </div>

      <div className="kiosk-card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-1.5">
              <Calendar className="w-3.5 h-3.5" /> Inativos há pelo menos
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" min={1} max={365}
                value={daysInactive}
                onChange={e => setDaysInactive(Math.max(1, parseInt(e.target.value || '1', 10)))}
                className="w-24 bg-muted border border-border rounded-lg px-3 py-2 text-sm"
              />
              <span className="text-sm text-muted-foreground">dias</span>
              {[7, 15, 30, 60].map(d => (
                <button key={d} onClick={() => setDaysInactive(d)}
                  className={`text-xs px-2.5 py-1 rounded-md border ${daysInactive === d ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border text-muted-foreground hover:border-primary/40'}`}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-1.5">
              <Search className="w-3.5 h-3.5" /> Buscar cliente
            </label>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Nome ou telefone"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {loading ? 'Carregando…' : `${filtered.length} cliente(s) inativo(s) há ${daysInactive}+ dias · ${customers.length} no total`}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="kiosk-card p-6 text-center text-sm text-muted-foreground">
          Nenhum cliente inativo no período selecionado.
        </div>
      ) : (
        <div className="kiosk-card p-0 overflow-hidden">
          <div className="divide-y divide-border/50 max-h-[60vh] overflow-y-auto">
            {filtered.map(c => (
              <div key={c.phone} className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary font-bold flex-shrink-0">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{c.name}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Phone className="w-3 h-3" /> {c.phone} · {c.orders} pedido(s)
                  </div>
                </div>
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-primary">{c.daysSince}d</div>
                  <div className="text-[10px] text-muted-foreground">sem comprar</div>
                </div>
                <button onClick={() => openCustomer(c)}
                  className="ml-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 hover:opacity-90">
                  <Sparkles className="w-3.5 h-3.5" /> Reativar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="relative max-w-lg w-full kiosk-card p-5 border-2 border-primary/40 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary font-black">
                {selected.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-black text-base truncate">{selected.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {selected.phone} · {selected.daysSince} dias sem comprar · último pedido R$ {selected.lastOrderTotal.toFixed(2)}
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Objetivo</label>
              <select value={objetivo} onChange={e => setObjetivo(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm">
                {OBJETIVOS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Contexto extra (opcional)</label>
              <input value={extras} onChange={e => setExtras(e.target.value)}
                placeholder="Ex.: cupom 20% OFF válido até domingo"
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
            </div>

            <button onClick={generate} disabled={generating}
              className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Gerando…' : 'Gerar mensagem com IA'}
            </button>

            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Mensagem</label>
              <textarea
                value={message} onChange={e => setMessage(e.target.value)}
                rows={5}
                placeholder="A mensagem gerada aparecerá aqui — você pode editar antes de enviar."
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm resize-none"
              />
            </div>

            <div className="flex gap-2">
              <button onClick={() => setSelected(null)}
                className="flex-1 px-3 py-2.5 rounded-lg bg-muted border border-border text-sm font-semibold">
                Cancelar
              </button>
              <a
                href={message ? buildWaUrl(selected.phone, message) : '#'}
                target="_blank" rel="noreferrer"
                onClick={e => { if (!message) { e.preventDefault(); toast.error('Gere ou escreva uma mensagem primeiro'); } }}
                className="flex-1 px-3 py-2.5 rounded-lg bg-success text-success-foreground text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90"
              >
                <MessageCircle className="w-4 h-4" /> Abrir WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CrmPanel;
