import { useEffect, useMemo, useRef, useState } from 'react';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const [openingWhatsApp, setOpeningWhatsApp] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotes, setProfileNotes] = useState('');
  const [profileTags, setProfileTags] = useState('');
  const [profileBirthDate, setProfileBirthDate] = useState('');
  const [profileConsent, setProfileConsent] = useState<'unknown' | 'opt_in' | 'opt_out'>('unknown');

  const mountedRef = useRef(true);
  const footerActionEpochRef = useRef(0);
  const generateEpochRef = useRef<number | null>(null);
  const whatsappEpochRef = useRef<number | null>(null);
  const organizationIdRef = useRef(organizationId);
  const selectedIdRef = useRef<string | null>(selected?.id || null);

  organizationIdRef.current = organizationId;
  selectedIdRef.current = selected?.id || null;

  const invalidateFooterActions = () => {
    footerActionEpochRef.current += 1;
    generateEpochRef.current = null;
    whatsappEpochRef.current = null;
    if (mountedRef.current) {
      setGenerating(false);
      setOpeningWhatsApp(false);
    }
  };

  const isCurrentFooterAction = (epoch: number, orgId: string, contactId: string) =>
    mountedRef.current
    && footerActionEpochRef.current === epoch
    && organizationIdRef.current === orgId
    && selectedIdRef.current === contactId;

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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      footerActionEpochRef.current += 1;
      generateEpochRef.current = null;
      whatsappEpochRef.current = null;
    };
  }, []);

  useEffect(() => {
    invalidateFooterActions();
    setSelected(null);
    setMessage('');
    void load();
  }, [organizationId]);

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
    invalidateFooterActions();
    setSelected(c);
    setObjetivo(c.lifecycle_stage === 'lead' ? 'novidade' : 'recuperar');
    setExtras('');
    setMessage('');
    setProfileNotes(c.notes || '');
    setProfileTags((c.tags || []).join(', '));
    setProfileBirthDate(c.birth_date || '');
    setProfileConsent(c.consent_status || 'unknown');
  };

  const closeCustomer = () => {
    invalidateFooterActions();
    setSelected(null);
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
    setSelected(current => current ? {
      ...current,
      notes: profileNotes.slice(0, 2000),
      tags,
      birth_date: profileBirthDate || null,
      consent_status: profileConsent,
    } : current);
    toast.success('Perfil CRM atualizado.');
    await load();
  };

  const generate = async () => {
    if (!selected || !organizationId) return;

    const epoch = footerActionEpochRef.current;
    if (generateEpochRef.current === epoch) return;

    const orgId = organizationId;
    const contactId = selected.id;
    generateEpochRef.current = epoch;
    setGenerating(true);

    try {
      const { data, error } = await supabase.functions.invoke('crm-generate-message', {
        body: {
          organization_id: orgId,
          contact_id: contactId,
          objetivo,
          loja: storeName || '',
          extras: extras || undefined,
        },
      });

      if (error) {
        let code = error?.message || '';
        const context = (error as any)?.context;
        if (context && typeof context.json === 'function') {
          try {
            const payload = await context.json();
            if (typeof payload?.error === 'string' && payload.error) code = payload.error;
          } catch {
            // Mantém a mensagem original do SDK quando o corpo não puder ser lido.
          }
        }
        throw new Error(code || 'Erro ao gerar mensagem');
      }

      if (typeof (data as any)?.error === 'string' && (data as any).error) {
        throw new Error((data as any).error);
      }

      const generatedBy = (data as any)?.generated_by;
      const generatedMessage = (data as any)?.message;
      if (
        (data as any)?.ok !== true
        || typeof generatedMessage !== 'string'
        || !generatedMessage.trim()
        || (generatedBy !== 'ai' && generatedBy !== 'template')
      ) {
        throw new Error('invalid_generation_response');
      }

      if (!isCurrentFooterAction(epoch, orgId, contactId)) return;

      setMessage(generatedMessage);
      if (generatedBy === 'template') {
        toast.info('Mensagem criada por template seguro; IA externa indisponível.');
      }
    } catch (error: any) {
      if (!isCurrentFooterAction(epoch, orgId, contactId)) return;

      const msg = error?.message === 'marketing_opt_out'
        ? 'Este contato optou por não receber marketing.'
        : error?.message === 'invalid_generation_response'
          ? 'Erro ao gerar mensagem'
          : error?.message || 'Erro ao gerar mensagem';
      toast.error(msg);
    } finally {
      if (generateEpochRef.current === epoch) {
        generateEpochRef.current = null;
        if (mountedRef.current && footerActionEpochRef.current === epoch) {
          setGenerating(false);
        }
      }
    }
  };

  const openWhatsApp = async () => {
    const trimmedMessage = message.trim();
    if (!selected || !organizationId || !trimmedMessage) {
      toast.error('Gere ou escreva uma mensagem primeiro.');
      return;
    }
    if (selected.consent_status === 'opt_out' && objetivo !== 'feedback') {
      toast.error('Este contato está marcado como opt-out de marketing.');
      return;
    }

    const epoch = footerActionEpochRef.current;
    if (whatsappEpochRef.current === epoch) return;

    const orgId = organizationId;
    const contactId = selected.id;
    const phone = selected.phone_normalized;
    const objective = objetivo;
    whatsappEpochRef.current = epoch;
    setOpeningWhatsApp(true);

    try {
      const { data, error } = await supabase.rpc('crm_record_interaction' as any, {
        _org: orgId,
        _contact_id: contactId,
        _objective: objective,
        _message: trimmedMessage,
        _channel: 'whatsapp',
        _status: 'opened',
      });
      if (error) throw error;
      if (typeof data !== 'string' || !UUID_RE.test(data)) {
        throw new Error('invalid_interaction_response');
      }

      if (!isCurrentFooterAction(epoch, orgId, contactId)) return;

      window.open(buildWaUrl(phone, trimmedMessage), '_blank', 'noopener,noreferrer');
      toast.success('WhatsApp aberto e interação registrada.');
      await load();
    } catch (error: any) {
      if (!isCurrentFooterAction(epoch, orgId, contactId)) return;

      if (error?.message === 'invalid_interaction_response') {
        toast.error('Não foi possível registrar a interação no CRM.');
      } else {
        toast.error(error?.message || 'Erro ao registrar interação no CRM.');
      }
    } finally {
      if (whatsappEpochRef.current === epoch) {
        whatsappEpochRef.current = null;
        if (mountedRef.current && footerActionEpochRef.current === epoch) {
          setOpeningWhatsApp(false);
        }
      }
    }
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
        <div
          className="fixed inset-0 z-[140] bg-background/90 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-3"
          onClick={closeCustomer}
        >
          <div
            className="w-full sm:max-w-xl max-h-[calc(100dvh-0.5rem)] sm:max-h-[92dvh] kiosk-card border border-primary/30 rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 border-b border-border/60 bg-background/95 shrink-0">
              <h3 className="font-black text-lg">{selected.name}</h3>
              <p className="text-xs text-muted-foreground">
                {selected.phone_normalized} · {selected.confirmed_orders} compra(s) confirmada(s) · {formatCurrency(selected.confirmed_revenue)}
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 overscroll-contain">
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

              <label className="text-xs font-semibold text-muted-foreground block">
                Contexto extra <span className="font-normal">(opcional)</span>
                <input value={extras} onChange={e => setExtras(e.target.value)}
                  placeholder="Ex.: cupom válido, novidade real, horário..."
                  className="w-full mt-1 bg-muted rounded-lg px-3 py-2 text-sm" />
              </label>

              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">Mensagem</label>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5}
                  placeholder="Toque em “Gerar mensagem” ou escreva aqui. Você pode editar antes de abrir o WhatsApp."
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm resize-none" />
              </div>

              <p className="text-[10px] text-muted-foreground pb-2">
                “Abrir WhatsApp” registra uma interação aberta. O CRM só atribui conversão quando houver novo pedido entregue e pago em até 30 dias.
              </p>
            </div>

            <div
              className="shrink-0 border-t border-border bg-background/95 backdrop-blur px-4 pt-3"
              style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
            >
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => void generate()}
                  disabled={generating || selected.consent_status === 'opt_out'}
                  className="py-3 rounded-xl bg-primary text-primary-foreground font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {generating ? 'Gerando…' : 'Gerar mensagem'}
                </button>
                <button
                  onClick={() => void openWhatsApp()}
                  disabled={openingWhatsApp || !message.trim()}
                  className="py-3 rounded-xl bg-success text-success-foreground font-black text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  <MessageCircle className="w-4 h-4" /> Abrir WhatsApp
                </button>
              </div>
              <button
                onClick={closeCustomer}
                className="w-full mt-2 py-2 rounded-lg text-xs font-bold text-muted-foreground"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CrmPanel;
