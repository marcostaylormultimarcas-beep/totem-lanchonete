import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Users, MessageCircle, Search, TrendingUp, Calendar, DollarSign, ShoppingBag, Target, Crown } from 'lucide-react';
import { formatCurrency } from '@/data/store';
import { BRAND_NAME } from '@/config/brandConfig';

interface Props { organizationId: string | null; storeName?: string }

type Contact = {
  id: string;
  phone_normalized: string;
  name: string;
  email: string;
  lifecycle_stage: 'lead' | 'customer' | 'vip';
  confirmed_orders: number;
  confirmed_revenue: number;
  last_purchase_at: string | null;
  favorite_product: string;
  consent_status: 'unknown' | 'opt_in' | 'opt_out';
  source: string;
};

type FilterKey = 'all' | 'clientes' | 'leads' | 'vip';

const buildWaUrl = (phone: string, msg: string) => {
  let n = (phone || '').replace(/\D/g, '');
  if (!n) return '#';
  if (n.length <= 11) n = '55' + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
};

const formatPhone = (raw: string) => {
  const n = (raw || '').replace(/\D/g, '');
  if (n.length === 11) return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return raw || '-';
};

const ClientesLeadsPanel = ({ organizationId, storeName }: Props) => {
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!organizationId) {
      setContacts([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    supabase
      .from('crm_contacts' as any)
      .select('id,phone_normalized,name,email,lifecycle_stage,confirmed_orders,confirmed_revenue,last_purchase_at,favorite_product,consent_status,source')
      .eq('organization_id', organizationId)
      .order('confirmed_revenue', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('[ClientesLeads] CRM load failed', error);
          setContacts([]);
        } else {
          setContacts(((data as any[]) || []).map((c: any) => ({
            ...c,
            confirmed_orders: Number(c.confirmed_orders || 0),
            confirmed_revenue: Number(c.confirmed_revenue || 0),
          })));
        }
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [organizationId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts.filter(c => {
      if (filter === 'clientes' && !['customer','vip'].includes(c.lifecycle_stage)) return false;
      if (filter === 'leads' && c.lifecycle_stage !== 'lead') return false;
      if (filter === 'vip' && c.lifecycle_stage !== 'vip') return false;
      if (term && !`${c.name} ${c.email} ${c.phone_normalized} ${c.favorite_product}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [contacts, filter, search]);

  const stats = useMemo(() => {
    const clientes = contacts.filter(c => ['customer','vip'].includes(c.lifecycle_stage)).length;
    const leads = contacts.filter(c => c.lifecycle_stage === 'lead').length;
    const vip = contacts.filter(c => c.lifecycle_stage === 'vip').length;
    const receita = contacts.reduce((sum, c) => sum + c.confirmed_revenue, 0);
    return { clientes, leads, vip, receita, total: contacts.length };
  }, [contacts]);

  const waMessageFor = (c: Contact) => {
    const store = storeName || BRAND_NAME;
    if (c.lifecycle_stage === 'lead') {
      return `Olá ${c.name || ''}! Aqui é da ${store}. Se quiser conhecer nosso cardápio, posso te ajudar por aqui.`;
    }
    return `Olá ${c.name}! Aqui é da ${store}. Temos novidades e será um prazer receber você novamente.`;
  };

  if (!organizationId) {
    return <div className="kiosk-card p-6 text-muted-foreground">Selecione uma loja.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Users className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Clientes e Leads</h2>
          <p className="text-xs text-muted-foreground">Base CRM persistente · receita somente de pedidos entregues e pagos</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Contatos', value: stats.total, icon: Users },
          { label: 'Clientes', value: stats.clientes, icon: ShoppingBag },
          { label: 'Leads reais', value: stats.leads, icon: Target },
          { label: 'Receita confirmada', value: formatCurrency(stats.receita), icon: DollarSign },
        ].map(k => (
          <div key={k.label} className="kiosk-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{k.label}</span>
              <k.icon className="w-4 h-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="kiosk-card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {([
            { k: 'all', label: 'Todos', icon: Users },
            { k: 'clientes', label: 'Clientes', icon: ShoppingBag },
            { k: 'leads', label: 'Leads', icon: Target },
            { k: 'vip', label: 'VIP', icon: Crown },
          ] as const).map(item => (
            <button key={item.k} onClick={() => setFilter(item.k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border ${filter === item.k ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border'}`}>
              <item.icon className="w-3.5 h-3.5" /> {item.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou produto favorito"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted border border-border text-sm outline-none" />
        </div>
      </div>

      <div className="kiosk-card overflow-hidden">
        {loading ? (
          <div className="p-10 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando contatos...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-sm">Nenhum contato neste filtro.</div>
        ) : (
          <div className="divide-y divide-border/50">
            {filtered.map(c => (
              <div key={c.id} className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-black shrink-0">
                  {c.lifecycle_stage === 'vip' ? <Crown className="w-4 h-4" /> : (c.name || 'C').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold truncate">{c.name || 'Sem nome'}</p>
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-muted">{c.lifecycle_stage}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{formatPhone(c.phone_normalized)} · {c.confirmed_orders} compra(s)</p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> {c.favorite_product || 'Sem produto favorito confirmado'}
                    {c.last_purchase_at && <> · <Calendar className="w-3 h-3 ml-1" /> {new Date(c.last_purchase_at).toLocaleDateString('pt-BR')}</>}
                  </p>
                </div>
                <div className="text-right hidden sm:block">
                  <p className="font-bold text-success">{formatCurrency(c.confirmed_revenue)}</p>
                  <p className="text-[10px] text-muted-foreground">confirmado</p>
                </div>
                {c.consent_status === 'opt_out' ? (
                  <span className="text-[10px] px-2 py-1 rounded bg-destructive/10 text-destructive">Opt-out</span>
                ) : (
                  <a href={buildWaUrl(c.phone_normalized, waMessageFor(c))} target="_blank" rel="noreferrer"
                    className="w-9 h-9 rounded-full bg-success/15 text-success border border-success/30 inline-flex items-center justify-center"
                    title="Abrir WhatsApp">
                    <MessageCircle className="w-4 h-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
          Exibindo {filtered.length} de {contacts.length} contatos · {stats.vip} VIP
        </div>
      </div>
    </div>
  );
};

export default ClientesLeadsPanel;
