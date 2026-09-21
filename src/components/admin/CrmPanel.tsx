import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';
import {
  Loader2, Users, MessageCircle, Sparkles, Phone, Search, Calendar,
  Target, Crown, ShoppingBag, DollarSign, History, Zap, ShieldCheck, Tag,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props { organizationId: string | null; storeName?: string }

type Contact = {
  id: string;
  organization_id: string;
  phone_normalized: string;
  name: string;
  email: string;
  birth_date: string | null;
  tags: string[];
  notes: string;
  consent_status: 'unknown' | 'opt_in' | 'opt_out';
  lifecycle_stage: 'lead' | 'customer' | 'vip';
  confirmed_orders: number;
  confirmed_revenue: number;
  average_ticket: number;
  last_purchase_at: string | null;
  last_order_total: number;
  favorite_product: string;
};

type Summary = {
  contacts: number;
  customers: number;
  leads: number;
  vip: number;
  inactive_15: number;
  confirmed_revenue: number;
  average_ticket: number;
  pending_tasks: number;
  conversions_30d: number;
  attributed_revenue_30d: number;
};

type Interaction = {
  id: string;
  contact_id: string;
  objective: string;
  channel: string;
  status: string;
  attributed_revenue: number;
  converted_at: string | null;
  created_at: string;
};

type Automation = {
  id: string;
  name: string;
  days_threshold: number | null;
  active: boolean;
};

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
  if (n.length <= 11) n = '55' + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
};

const daysSince = (iso: string | null) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null;

const emptySummary: Summary = {
  contacts: 0, customers: 0, leads: 0, vip: 0, inactive_15: 0,
  confirmed_revenue: 0, average_ticket: 0, pending_tasks: 0,
  conversions_30d: 0, attributed_revenue_30d: 0,
};

const CrmPanel = ({ organizationId, storeName }: Props) => {
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [segment, setSegment] = useState<'inactive' | 'all' | 'lead' | 'customer' | 'vip'>('inactive');
  const [daysInactive, setDaysInactive] = useState(15);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [objetivo, setObjetivo] = useState('recuperar');
  const [extras, setExtras] = useState('');
  const [message, setMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotes, setProfileNotes] = useState('');
  const [profileTags, setProfileTags] = useState('');
  const [profileBirthDate, setProfileBirthDate] = useState('');
  const [profileConsent, setProfileConsent] = useState<'unknown' | 'opt_in' | 'opt_out'>('unknown');

  const load = async () => {
    if (!organizationId) {
      setContacts([]);
      setSummary(emptySummary);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      await supabase.rpc('crm_refresh_tasks' as any, { _org: organizationId });

      const [contactsRes, summaryRes, interactionsRes, automationsRes] = await Promise.all([
        supabase
          .from('crm_contacts' as any)
          .select('id,organization_id,phone_normalized,name,email,birth_date,tags,notes,consent_status,lifecycle_stage,confirmed_orders,confirmed_revenue,average_ticket,last_purchase_at,last_order_total,favorite_product')
          .eq('organization_id', organizationId)
          .order('last_purchase_at', { ascending: false, nullsFirst: false }),
        supabase.rpc('crm_summary' as any, { _org: organizationId }),
        supabase
          .from('crm_interactions' as any)
          .select('id,contact_id,objective,channel,status,attributed_revenue,converted_at,created_at')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('crm_automations' as any)
          .select('id,name,days_threshold,active')
          .eq('organization_id', organizationId)
          .eq('trigger_type', 'inactive')
          .order('days_threshold'),
      ]);

      if (contactsRes.error) throw contactsRes.error;
      if (summaryRes.error) throw summaryRes.error;
      if (interactionsRes.error) throw interactionsRes.error;
      if (automationsRes.error) throw automationsRes.error;

      setContacts(((contactsRes.data as any[]) || []).map((c: any) => ({
        ...c,
        tags: Array.isArray(c.tags) ? c.tags : [],
        confirmed_orders: Number(c.confirmed_orders || 0),
        confirmed_revenue: Number(c.confirmed_revenue || 0),
        average_ticket: Number(c.average_ticket || 0),
        last_order_total: Number(c.last_order_total || 0),
      })));
      setSummary({ ...emptySummary, ...((summaryRes.data as any) || {}) });
      setInteractions(((interactionsRes.data as any[]) || []).map((i: any) => ({
        ...i,
        attributed_revenue: Number(i.attributed_revenue || 0),
      })));
      setAutomations((automationsRes.data as any[]) || []);
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao carregar CRM');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [organizationId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter(c => {
      const inactive = daysSince(c.last_purchase_at);
      if (segment === 'inactive' && (inactive == null || inactive < daysInactive)) return false;
      if (segment === 'lead' && c.lifecycle_stage !== 'lead') return false;
      if (segment === 'customer' && c.lifecycle_stage !== 'customer') return false;
      if (segment === 'vip' && c.lifecycle_stage !== 'vip') return false;
      if (q) {
        const hay = `${c.name} ${c.phone_normalized} ${c.favorite_product} ${c.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [contacts, segment, daysInactive, search]);

  const openCustomer = (c: Contact) => {
    setSelected(c);
    setObjetivo(c.lifecycle_stage === 'lead' ? 'novidade' : 'recuperar');
    setExtras('');
    setMessage('');
    setProfileNotes(c.notes || '');
    setProfileTags((c.tags || []).join(', '));
    setProfileBirthDate(c.birth_date || '');
    setProfileConsent(c.consent_status || 'unknown');
  };

  const saveProfile = async () => {
    if (!selected) return;
    setSavingProfile(true);
    const tags = [...new Set(profileTags.split(',').map(v => v.trim()).filter(Boolean))].slice(0, 20);
    const { error } = await supabase
      .from('crm_contacts' as any)
      .update({
        notes: profileNotes.slice(0, 2000),
        tags,
        birth_date: profileBirthDate || null,
        consent_status: profileConsent,
        consent_at: profileConsent === 'unknown' ? null : new Date().toISOString(),
        consent_source: profileConsent === 'unknown' ? '' : 'admin',
      })
      .eq('id', selected.id)
      .eq('organization_id', organizationId!);
    setSavingProfile(false);
    if (error) return toast.error(error.message);
    toast.success('Perfil CRM atualizado.');
    await load();
  };

  const generate = async () => {
    if (!selected || !organizationId) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('crm-generate-message', {
        body: {
          organization_id: organizationId,
          contact_id: selected.id,
          objetivo,
          loja: storeName || '',
          extras: extras || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setMessage((data as any)?.message || '');
      if ((data as any)?.generated_by === 'template') {
        toast.info('Mensagem criada por template seguro; IA externa indisponível.');
      }
    } catch (error: any) {
      const msg = error?.message === 'marketing_opt_out'
        ? 'Este contato optou por não receber marketing.'
        : error?.message || 'Erro ao gerar mensagem';
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  const openWhatsApp = async () => {
    if (!selected || !organizationId || !message.trim()) {
      toast.error('Gere ou escreva uma mensagem primeiro.');
      return;
    }
    if (selected.consent_status === 'opt_out' && objetivo !== 'feedback') {
      toast.error('Este contato está marcado como opt-out de marketing.');
      return;
    }

    const { error } = await supabase.rpc('crm_record_interaction' as any, {
      _org: organizationId,
      _contact_id: selected.id,
      _objective: objetivo,
      _message: message.trim(),
      _channel: 'whatsapp',
      _status: 'opened',
    });
    if (error) {
      toast.error(error.message);
      return;
    }

    window.open(buildWaUrl(selected.phone_normalized, message.trim()), '_blank', 'noopener,noreferrer');
    toast.success('WhatsApp aberto e interação registrada.');
    await load();
  };

  const toggleAutomation = async (automation: Automation) => {
    const { error } = await supabase
      .from('crm_automations' as any)
      .update({ active: !automation.active, updated_at: new Date().toISOString() })
      .eq('id', automation.id)
      .eq('organization_id', organizationId!);
    if (error) return toast.error(error.message);
    await load();
  };

  const contactName = (id: string) => contacts.find(c => c.id === id)?.name || 'Cliente';

  if (loading) {
    return <div className="px-4 py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="px-4 space-y-5 pb-10">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        <div>
          <h2 className="font-black text-lg">CRM — Retenção e Relacionamento</h2>
          <p className="text-xs text-muted-foreground">Métricas usam somente pedidos entregues e pagos.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[
          { label: 'Clientes', value: summary.customers, icon: ShoppingBag },
          { label: 'Leads', value: summary.leads, icon: Target },
          { label: 'Receita confirmada', value: formatCurrency(Number(summary.confirmed_revenue || 0)), icon: DollarSign },
          { label: 'Recuperado 30d', value: formatCurrency(Number(summary.attributed_revenue_30d || 0)), icon: Sparkles },
        ].map(k => (
          <div key={k.label} className="kiosk-card p-3">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[10px] uppercase font-bold">{k.label}</span>
              <k.icon className="w-4 h-4 text-primary" />
            </div>
            <p className="text-xl font-black mt-1">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="kiosk-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h3 className="font-bold">Automações de reativação</h3>
          <span className="ml-auto text-[10px] text-muted-foreground">gera fila; não envia sozinho</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {automations.map(a => (
            <button
              key={a.id}
              onClick={() => void toggleAutomation(a)}
              className={`rounded-xl border px-3 py-2 text-left ${a.active ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30'}`}
            >
              <p className="text-sm font-bold">{a.days_threshold} dias</p>
              <p className="text-[10px] text-muted-foreground">{a.active ? 'Ativa' : 'Pausada'}</p>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {summary.pending_tasks} ação(ões) pendente(s). O CRM cria sugestões automaticamente, mas o envio continua sob controle do lojista.
        </p>
      </div>

      <div className="kiosk-card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {[
            ['inactive','Inativos'],['all','Todos'],['lead','Leads'],['customer','Clientes'],['vip','VIP'],
          ].map(([key,label]) => (
            <button key={key} onClick={() => setSegment(key as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${segment===key ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border'}`}>
              {label}
            </button>
          ))}
        </div>

        {segment === 'inactive' && (
          <div className="flex items-center gap-2 overflow-x-auto">
            <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
            {[7,15,30,60].map(d => (
              <button key={d} onClick={() => setDaysInactive(d)}
                className={`px-3 py-1 rounded-lg text-xs border ${daysInactive===d ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border'}`}>
                {d}d
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar nome, telefone, produto ou tag"
            className="w-full pl-9 pr-3 py-2.5 bg-muted rounded-xl outline-none" />
        </div>
        <p className="text-xs text-muted-foreground">{filtered.length} contato(s) neste segmento · {summary.vip} VIP</p>
      </div>

      {filtered.length === 0 ? (
        <div className="kiosk-card p-7 text-center text-sm text-muted-foreground">
          Nenhum contato neste segmento.
        </div>
      ) : (
        <div className="kiosk-card p-0 overflow-hidden">
          <div className="divide-y divide-border/50 max-h-[65vh] overflow-y-auto">
            {filtered.map(c => {
              const inactive = daysSince(c.last_purchase_at);
              return (
                <button key={c.id} onClick={() => openCustomer(c)}
                  className="w-full p-3 text-left flex items-center gap-3 hover:bg-muted/40">
                  <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center font-black text-primary shrink-0">
                    {c.lifecycle_stage === 'vip' ? <Crown className="w-4 h-4" /> : c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm truncate">{c.name}</p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted uppercase">{c.lifecycle_stage}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      <Phone className="w-3 h-3 inline mr-1" />{c.phone_normalized}
                      {c.confirmed_orders > 0 && <> · {c.confirmed_orders} compra(s) · {formatCurrency(c.confirmed_revenue)}</>}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {c.favorite_product ? `Preferido: ${c.favorite_product}` : 'Sem produto favorito confirmado'}
                      {inactive != null ? ` · ${inactive}d desde a última compra` : ''}
                    </p>
                  </div>
                  <Sparkles className="w-4 h-4 text-primary shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="kiosk-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">Atividade recente</h3>
        </div>
        {interactions.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma ação CRM registrada ainda.</p>
        ) : interactions.slice(0, 8).map(i => (
          <div key={i.id} className="flex items-center justify-between gap-2 text-xs border-t border-border/50 pt-2">
            <span className="truncate">{contactName(i.contact_id)} · {i.objective} · {i.status}</span>
            <span className="text-muted-foreground shrink-0">
              {i.converted_at ? `+ ${formatCurrency(i.attributed_revenue)}` : new Date(i.created_at).toLocaleDateString('pt-BR')}
            </span>
          </div>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-md flex items-center justify-center p-3" onClick={() => setSelected(null)}>
          <div className="max-w-xl w-full max-h-[92vh] overflow-y-auto kiosk-card p-5 border border-primary/30 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="font-black text-lg">{selected.name}</h3>
              <p className="text-xs text-muted-foreground">
                {selected.phone_normalized} · {selected.confirmed_orders} compra(s) confirmada(s) · {formatCurrency(selected.confirmed_revenue)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-muted-foreground">Ticket médio</p>
                <p className="font-bold">{formatCurrency(selected.average_ticket)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-muted-foreground">Última compra</p>
                <p className="font-bold">{selected.last_purchase_at ? new Date(selected.last_purchase_at).toLocaleDateString('pt-BR') : 'Nenhuma confirmada'}</p>
              </div>
            </div>

            <div className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /><p className="font-bold text-sm">Perfil CRM</p></div>
              <label className="text-xs block">Consentimento de marketing
                <select value={profileConsent} onChange={e => setProfileConsent(e.target.value as any)}
                  className="w-full mt-1 bg-muted rounded-lg px-3 py-2">
                  <option value="unknown">Não informado</option>
                  <option value="opt_in">Autorizado</option>
                  <option value="opt_out">Não deseja receber</option>
                </select>
              </label>
              <label className="text-xs block">Aniversário
                <input type="date" value={profileBirthDate} onChange={e => setProfileBirthDate(e.target.value)}
                  className="w-full mt-1 bg-muted rounded-lg px-3 py-2" />
              </label>
              <label className="text-xs block"><Tag className="w-3 h-3 inline mr-1" />Tags
                <input value={profileTags} onChange={e => setProfileTags(e.target.value)}
                  placeholder="VIP, almoço, pizza..." className="w-full mt-1 bg-muted rounded-lg px-3 py-2" />
              </label>
              <label className="text-xs block">Observações
                <textarea value={profileNotes} onChange={e => setProfileNotes(e.target.value)}
                  rows={2} className="w-full mt-1 bg-muted rounded-lg px-3 py-2 resize-none" />
              </label>
              <button onClick={() => void saveProfile()} disabled={savingProfile}
                className="w-full py-2 rounded-lg border border-primary/30 text-primary font-bold text-sm">
                {savingProfile ? 'Salvando…' : 'Salvar perfil'}
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">Objetivo</label>
              <select value={objetivo} onChange={e => setObjetivo(e.target.value)}
                className="w-full bg-muted rounded-lg px-3 py-2">
                {OBJETIVOS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>

            <input value={extras} onChange={e => setExtras(e.target.value)}
              placeholder="Contexto extra: cupom válido, novidade real, horário..."
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm" />

            <button onClick={() => void generate()} disabled={generating || selected.consent_status === 'opt_out'}
              className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Gerar mensagem
            </button>

            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
              placeholder="A mensagem aparecerá aqui e pode ser editada antes de abrir o WhatsApp."
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm resize-none" />

            <div className="flex gap-2">
              <button onClick={() => setSelected(null)}
                className="flex-1 py-2.5 rounded-lg bg-muted border border-border font-bold text-sm">Fechar</button>
              <button onClick={() => void openWhatsApp()}
                className="flex-1 py-2.5 rounded-lg bg-success text-success-foreground font-bold text-sm flex items-center justify-center gap-2">
                <MessageCircle className="w-4 h-4" /> Abrir WhatsApp
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              “Abrir WhatsApp” registra uma interação aberta. O CRM só atribui conversão quando houver novo pedido entregue e pago em até 30 dias.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CrmPanel;
