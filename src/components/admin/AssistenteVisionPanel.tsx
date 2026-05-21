import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Sparkles, Loader2, Check, X, Send, Pencil, Users, TrendingUp,
  Crown, Share2, Bell, RefreshCw, Bot, Clock,
} from 'lucide-react';

interface Props { organizationId: string | null; storeName?: string; whatsappNumber?: string }

interface OrderRow {
  id: string; customer_name: string; customer_phone: string;
  total: number; created_at: string; status: string;
}

interface Suggestion {
  key: string;
  priority: number;
  icon: any;
  title: string;
  description: string;
  template: string;
  audience: { phone: string; name: string }[]; // optional broadcast list
  category: 'retencao' | 'ticket' | 'prime' | 'parceria' | 'reativacao';
}

const normalizePhone = (raw: string) => (raw || '').replace(/\D/g, '');
const buildWaUrl = (phone: string, msg: string) => {
  let n = normalizePhone(phone);
  if (!n) return '#';
  if (n.length <= 11) n = '55' + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
};
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const AssistenteVisionPanel = ({ organizationId, storeName = 'nossa loja' }: Props) => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [primeActive, setPrimeActive] = useState(false);
  const [parceriasAtivas, setParceriasAtivas] = useState(0);
  const [feedback, setFeedback] = useState<Record<string, { action: string; reason: string }>>({});
  const [editing, setEditing] = useState<Suggestion | null>(null);
  const [editText, setEditText] = useState('');
  const [dismissingKey, setDismissingKey] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!organizationId) return;
    const load = async () => {
      setLoading(true);
      const [ord, prime, parc, fb] = await Promise.all([
        supabase.from('orders').select('id,customer_name,customer_phone,total,created_at,status')
          .eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(1000),
        supabase.from('vision_prime_config').select('ativo').eq('organization_id', organizationId).maybeSingle(),
        supabase.from('parcerias').select('id,status,habilitada_origem,habilitada_parceira')
          .or(`org_origem.eq.${organizationId},org_parceira.eq.${organizationId}`),
        supabase.from('assistente_vision_feedback').select('suggestion_key,action,reason')
          .eq('organization_id', organizationId),
      ]);
      setOrders((ord.data as OrderRow[]) || []);
      setPrimeActive(Boolean(prime.data?.ativo));
      setParceriasAtivas(((parc.data as any[]) || []).filter(p => p.status === 'active' && p.habilitada_origem && p.habilitada_parceira).length);
      const map: Record<string, { action: string; reason: string }> = {};
      ((fb.data as any[]) || []).forEach(r => { map[r.suggestion_key] = { action: r.action, reason: r.reason || '' }; });
      setFeedback(map);
      setLoading(false);
    };
    load();
  }, [organizationId, refreshTick]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!orders.length) return [];
    const now = Date.now();
    const byPhone = new Map<string, { name: string; phone: string; last: number; total: number; count: number; sum: number }>();
    orders.forEach(o => {
      const phone = normalizePhone(o.customer_phone);
      if (!phone) return;
      const ts = new Date(o.created_at).getTime();
      const cur = byPhone.get(phone);
      if (!cur) byPhone.set(phone, { name: o.customer_name || 'Cliente', phone, last: ts, total: Number(o.total) || 0, count: 1, sum: Number(o.total) || 0 });
      else { cur.count++; cur.sum += Number(o.total) || 0; if (ts > cur.last) { cur.last = ts; cur.total = Number(o.total) || 0; cur.name = o.customer_name || cur.name; } }
    });
    const clientes = Array.from(byPhone.values());
    const inativos = clientes.filter(c => (now - c.last) / 86400000 >= 40);
    const ticketMedio = clientes.length ? clientes.reduce((s, c) => s + c.sum, 0) / orders.length : 0;
    const ticketBaixo = clientes.filter(c => (c.sum / c.count) < ticketMedio * 0.7 && c.count >= 2);
    const aniversariantes: typeof clientes = []; // sem data nascimento — placeholder
    const vips = clientes.filter(c => c.count >= 5).sort((a, b) => b.sum - a.sum).slice(0, 30);

    const out: Suggestion[] = [];

    if (inativos.length >= 1) {
      out.push({
        key: 'recuperar_inativos_40d',
        priority: 1,
        icon: Users,
        category: 'reativacao',
        title: 'Recuperar Clientes Inativos',
        description: `Você tem ${inativos.length} cliente${inativos.length > 1 ? 's' : ''} que não pede${inativos.length > 1 ? 'm' : ''} há 40 dias ou mais.`,
        template: `Olá [Nome], sua última escolha em ${storeName} está com saudade! 😋 Volte hoje com o cupom *VOLTE15* e ganhe 10% OFF no seu pedido.`,
        audience: inativos.map(c => ({ phone: c.phone, name: c.name })),
      });
    }

    if (ticketBaixo.length >= 1 && ticketMedio > 0) {
      out.push({
        key: 'aumentar_ticket_medio',
        priority: 2,
        icon: TrendingUp,
        category: 'ticket',
        title: 'Aumentar Ticket Médio',
        description: `${ticketBaixo.length} cliente${ticketBaixo.length > 1 ? 's' : ''} compra${ticketBaixo.length > 1 ? 'm' : ''} sempre abaixo do ticket médio (${brl(ticketMedio)}). Ofereça combos.`,
        template: `Oi [Nome]! Que tal turbinar seu pedido? 🍔🍟 Adicione nosso *Combo do Dia* e leve batata + refri por só R$ 15. Aproveite!`,
        audience: ticketBaixo.map(c => ({ phone: c.phone, name: c.name })),
      });
    }

    if (!primeActive) {
      out.push({
        key: 'ativar_vision_prime',
        priority: 3,
        icon: Crown,
        category: 'prime',
        title: 'Ative o Clube Vision Prime',
        description: 'Você ainda não ativou o clube de assinatura. Lojas com Prime ativo aumentam em até 30% a recorrência mensal.',
        template: `🌟 Cliente VIP! Apresentamos o *Vision Prime* em ${storeName}: por R$ 19,90/mês você ganha 10% OFF em todos os pedidos e frete grátis. Assine hoje mesmo!`,
        audience: vips.map(c => ({ phone: c.phone, name: c.name })),
      });
    } else if (vips.length >= 1) {
      out.push({
        key: 'oferecer_prime_vips',
        priority: 2,
        icon: Crown,
        category: 'prime',
        title: 'Convide VIPs para o Vision Prime',
        description: `${vips.length} clientes com 5+ pedidos. Eles são os candidatos perfeitos para virar assinantes Prime.`,
        template: `Olá [Nome], você é um dos nossos clientes mais especiais! 💎 Queremos te convidar para o *Vision Prime*: 10% OFF em todos os pedidos + frete grátis. Apenas R$ 19,90/mês. Quer fazer parte?`,
        audience: vips.map(c => ({ phone: c.phone, name: c.name })),
      });
    }

    if (parceriasAtivas === 0) {
      out.push({
        key: 'iniciar_co_marketing',
        priority: 4,
        icon: Share2,
        category: 'parceria',
        title: 'Inicie uma Parceria de Co-Marketing',
        description: 'Você ainda não tem parcerias ativas. Troque clientes com lojas vizinhas e amplie seu alcance sem gastar com mídia.',
        template: '',
        audience: [],
      });
    } else {
      out.push({
        key: 'divulgar_parceria',
        priority: 3,
        icon: Share2,
        category: 'parceria',
        title: 'Divulgue suas parcerias ativas',
        description: `Você tem ${parceriasAtivas} parceria${parceriasAtivas > 1 ? 's' : ''} ativa${parceriasAtivas > 1 ? 's' : ''}. Avise seus clientes sobre os cupons cruzados que eles ganham!`,
        template: `Oi [Nome]! 🎁 A cada pedido em ${storeName}, você ganha cupom de desconto em nossa loja parceira. Faça já seu próximo pedido e aproveite!`,
        audience: clientes.slice(0, 50).map(c => ({ phone: c.phone, name: c.name })),
      });
    }

    return out
      .filter(s => feedback[s.key]?.action !== 'dismissed')
      .sort((a, b) => a.priority - b.priority);
  }, [orders, primeActive, parceriasAtivas, feedback, storeName]);

  const registerFeedback = async (key: string, action: 'approved' | 'dismissed' | 'sent', reason = '', message_sent = '') => {
    if (!organizationId) return;
    const { error } = await supabase.from('assistente_vision_feedback').insert({
      organization_id: organizationId, suggestion_key: key, action, reason, message_sent,
    });
    if (error) { toast.error('Erro ao registrar feedback'); return; }
    setFeedback(prev => ({ ...prev, [key]: { action, reason } }));
  };

  const handleConfirmDispatch = async (s: Suggestion, msgOverride?: string) => {
    const msg = msgOverride ?? s.template;
    if (!s.audience.length) {
      toast.info('Esta sugestão não tem lista de envio. Use o link manual.');
      return;
    }
    const first = s.audience[0];
    const personalizada = msg.replace(/\[Nome\]/g, first.name.split(' ')[0]);
    window.open(buildWaUrl(first.phone, personalizada), '_blank');
    await registerFeedback(s.key, 'sent', '', msg);
    toast.success(`Mensagem aberta no WhatsApp para ${first.name}. Total na fila: ${s.audience.length}`);
  };

  const extractCoupon = (msg: string) => {
    const m = msg.match(/\*([A-Z0-9]{3,20})\*/) || msg.match(/cupom[^A-Z0-9]*([A-Z0-9]{3,20})/i);
    return m ? m[1].toUpperCase() : '';
  };

  const handleApprove = async (s: Suggestion) => {
    await registerFeedback(s.key, 'approved');

    // Dispara notificações in-app para a audiência (sininho do cliente + push interno)
    if (s.audience.length && organizationId) {
      const phones = s.audience.map(a => a.phone).filter(Boolean);
      const { data, error } = await supabase.rpc('notify_audience' as any, {
        _org: organizationId,
        _suggestion_key: s.key,
        _title: s.title,
        _body: s.template ? s.template.replace(/\*/g, '') : s.description,
        _cta_route: '',
        _coupon: extractCoupon(s.template || ''),
        _phones: phones,
      });
      if (error) {
        toast.success('Sugestão aprovada (notificações não enviadas: ' + error.message + ')');
      } else {
        toast.success(`Sugestão aprovada — ${data ?? 0} notificações enviadas`);
      }
    } else {
      toast.success('Sugestão aprovada — marcada como em andamento');
    }
  };


  const submitDismiss = async () => {
    if (!dismissingKey) return;
    await registerFeedback(dismissingKey, 'dismissed', dismissReason || 'sem motivo informado');
    toast.success('Sugestão dispensada. A IA não vai repetir esta recomendação.');
    setDismissingKey(null); setDismissReason('');
  };

  const openEdit = (s: Suggestion) => { setEditing(s); setEditText(s.template); };

  if (!organizationId) {
    return <div className="p-6 text-center text-muted-foreground">Selecione uma loja para usar o Assistente.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-primary/30 bg-gradient-to-br from-primary/15 via-background to-background p-5">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-primary/20 rounded-full blur-3xl" />
        <div className="relative flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center">
            <Bot className="w-7 h-7 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-black">Assistente Vision</h2>
              <span className="text-[10px] uppercase font-bold bg-primary/20 text-primary px-2 py-0.5 rounded-full">IA</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Seu consultor de marketing inteligente. Analisamos seus pedidos e sugerimos ações para você crescer.
            </p>
          </div>
          <button onClick={() => setRefreshTick(t => t + 1)} className="touch-btn px-3 py-2 rounded-xl bg-muted hover:bg-muted/70 flex items-center gap-2 text-sm">
            <RefreshCw className="w-4 h-4" /> Atualizar
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Analisando seus dados…</div>
      ) : suggestions.length === 0 ? (
        <div className="kiosk-card p-8 text-center">
          <Sparkles className="w-10 h-10 mx-auto text-primary mb-3" />
          <p className="font-bold">Tudo certo por aqui!</p>
          <p className="text-sm text-muted-foreground mt-1">Nenhuma sugestão nova no momento. Volte amanhã 😉</p>
        </div>
      ) : (
        <div className="space-y-3">
          {suggestions.map(s => {
            const fb = feedback[s.key];
            const Icon = s.icon;
            return (
              <div key={s.key} className="kiosk-card p-4 border border-border">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold">{s.title}</h3>
                      {fb?.action === 'approved' && <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">EM ANDAMENTO</span>}
                      {fb?.action === 'sent' && <span className="text-[10px] font-bold bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">DISPARADO</span>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{s.description}</p>

                    {s.template && (
                      <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border text-sm whitespace-pre-wrap">
                        <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Mensagem sugerida</div>
                        {s.template}
                      </div>
                    )}

                    {s.audience.length > 0 && (
                      <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" /> {s.audience.length} destinatário{s.audience.length > 1 ? 's' : ''}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {s.template && (
                        <button onClick={() => openEdit(s)} className="touch-btn px-3 py-2 rounded-lg bg-muted hover:bg-muted/70 text-sm flex items-center gap-1.5">
                          <Pencil className="w-4 h-4" /> Editar
                        </button>
                      )}
                      {s.template && s.audience.length > 0 && (
                        <button onClick={() => handleConfirmDispatch(s)} className="touch-btn px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center gap-1.5 hover:opacity-90">
                          <Send className="w-4 h-4" /> Confirmar Disparo
                        </button>
                      )}
                      <button onClick={() => handleApprove(s)} className="touch-btn px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-sm font-bold flex items-center gap-1.5">
                        <Check className="w-4 h-4" /> Aprovar
                      </button>
                      <button onClick={() => { setDismissingKey(s.key); setDismissReason(''); }} className="touch-btn px-3 py-2 rounded-lg bg-muted hover:bg-destructive/20 hover:text-destructive text-sm flex items-center gap-1.5">
                        <X className="w-4 h-4" /> Dispensar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="kiosk-card w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold flex items-center gap-2"><MessageCircle className="w-5 h-5 text-primary" /> Editar mensagem</h3>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-muted-foreground mb-2">Use <code className="bg-muted px-1 rounded">[Nome]</code> para personalizar.</p>
            <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={6} className="w-full p-3 rounded-lg bg-muted border border-border text-sm" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-lg bg-muted hover:bg-muted/70 font-bold text-sm">Cancelar</button>
              <button
                onClick={async () => { const s = editing!; setEditing(null); await handleConfirmDispatch(s, editText); }}
                className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-1.5">
                <Send className="w-4 h-4" /> Salvar e Disparar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dismiss modal */}
      {dismissingKey && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDismissingKey(null)}>
          <div className="kiosk-card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-2">Por que dispensar?</h3>
            <p className="text-xs text-muted-foreground mb-3">Conta pra IA o motivo — assim não vamos repetir sugestões parecidas.</p>
            <select value={dismissReason} onChange={e => setDismissReason(e.target.value)} className="w-full p-3 rounded-lg bg-muted border border-border text-sm mb-2">
              <option value="">Selecione…</option>
              <option value="ja_fiz">Já fiz essa ação recentemente</option>
              <option value="nao_relevante">Não é relevante pra minha loja</option>
              <option value="audiencia_errada">Público sugerido está errado</option>
              <option value="mensagem_ruim">Não gostei da mensagem</option>
              <option value="outro">Outro motivo</option>
            </select>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setDismissingKey(null)} className="flex-1 py-2.5 rounded-lg bg-muted hover:bg-muted/70 font-bold text-sm">Cancelar</button>
              <button onClick={submitDismiss} disabled={!dismissReason} className="flex-1 py-2.5 rounded-lg bg-destructive text-destructive-foreground font-bold text-sm disabled:opacity-50">Dispensar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssistenteVisionPanel;
