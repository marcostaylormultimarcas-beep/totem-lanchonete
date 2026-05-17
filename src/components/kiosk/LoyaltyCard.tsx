import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Award, Check, Star, Gift, X, Trophy, History as HistoryIcon } from 'lucide-react';
import { formatCurrency } from '@/data/store';

interface Props {
  organizationId: string | null;
  customerPhone: string;
  className?: string;
}

interface Config {
  ativo: boolean;
  meta_pedidos: number;
  valor_minimo_pedido: number;
  premio_recompensa: string;
  descricao_premio: string;
  premio_imagem: string;
}

interface Resgate {
  id: string;
  premio_texto: string;
  premio_imagem: string;
  codigo_resgate: string;
  status: 'pendente' | 'utilizado';
  created_at: string;
  used_at: string | null;
}

const sanitizePhone = (p: string) => p.replace(/\D/g, '');
const SEEN_KEY = (org: string, phone: string) => `fid-seen-${org}-${phone}`;

const LoyaltyCard = ({ organizationId, customerPhone, className = '' }: Props) => {
  const [config, setConfig] = useState<Config | null>(null);
  const [stamps, setStamps] = useState(0);
  const [resgates, setResgates] = useState<Resgate[]>([]);
  const [modal, setModal] = useState<Resgate | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!organizationId) { setConfig(null); return; }
    supabase.from('config_fidelidade' as any).select('*').eq('organization_id', organizationId).maybeSingle()
      .then(({ data }) => {
        if (!data) { setConfig(null); return; }
        const d = data as any;
        setConfig({
          ativo: !!d.ativo,
          meta_pedidos: Number(d.meta_pedidos) || 10,
          valor_minimo_pedido: Number(d.valor_minimo_pedido) || 0,
          premio_recompensa: d.premio_recompensa || '',
          descricao_premio: d.descricao_premio || '',
          premio_imagem: d.premio_imagem || '',
        });
      });
  }, [organizationId]);

  const phone = sanitizePhone(customerPhone);

  const fetchResgates = async () => {
    if (!organizationId || !phone || phone.length < 8) { setResgates([]); return; }
    const { data } = await supabase.from('resgates_fidelidade' as any)
      .select('*')
      .eq('organization_id', organizationId)
      .eq('telefone_cliente', phone)
      .order('created_at', { ascending: false })
      .limit(20);
    const list = (data as any) || [];
    setResgates(list);
    // Auto-open modal for newest pending resgate not yet seen
    if (organizationId && phone) {
      const seen = JSON.parse(localStorage.getItem(SEEN_KEY(organizationId, phone)) || '[]');
      const fresh = list.find((r: Resgate) => r.status === 'pendente' && !seen.includes(r.id));
      if (fresh) setModal(fresh);
    }
  };

  useEffect(() => {
    if (!organizationId || !phone || phone.length < 8) { setStamps(0); setResgates([]); return; }
    let cancelled = false;
    supabase.from('progresso_fidelidade' as any)
      .select('quantidade_carimbos')
      .eq('organization_id', organizationId)
      .eq('telefone_cliente', phone)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setStamps(Number((data as any)?.quantidade_carimbos) || 0); });

    fetchResgates();

    const channel = supabase
      .channel(`fid-${organizationId}-${phone}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'progresso_fidelidade', filter: `organization_id=eq.${organizationId}` },
        (payload: any) => {
          if (payload.new?.telefone_cliente === phone) {
            setStamps(Number(payload.new?.quantidade_carimbos) || 0);
          }
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'resgates_fidelidade', filter: `organization_id=eq.${organizationId}` },
        () => { fetchResgates(); })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [organizationId, customerPhone]);

  const dismissModal = () => {
    if (modal && organizationId && phone) {
      const key = SEEN_KEY(organizationId, phone);
      const seen = JSON.parse(localStorage.getItem(key) || '[]');
      if (!seen.includes(modal.id)) {
        seen.push(modal.id);
        localStorage.setItem(key, JSON.stringify(seen));
      }
    }
    setModal(null);
  };

  if (!config?.ativo) return null;

  const meta = Math.max(1, config.meta_pedidos);
  const filled = Math.min(stamps, meta);
  const remaining = Math.max(0, meta - filled);
  const completed = remaining === 0;
  const pendingCount = resgates.filter(r => r.status === 'pendente').length;

  return (
    <>
      <div className={`relative overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-br from-card via-card to-primary/10 p-5 shadow-[0_8px_30px_-12px_hsl(var(--primary)/0.5)] ${className}`}>
        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-primary/20 blur-2xl pointer-events-none" />
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Award className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-primary font-semibold">Cartão Fidelidade</div>
              <div className="text-sm text-foreground font-bold truncate">{config.premio_recompensa}</div>
            </div>
          </div>
          {resgates.length > 0 && (
            <button onClick={() => setHistoryOpen(true)}
              className="touch-btn relative bg-primary/15 text-primary px-2.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0">
              <HistoryIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Meus prêmios</span>
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-accent text-accent-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {pendingCount}
                </span>
              )}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 my-4">
          {Array.from({ length: meta }).map((_, i) => {
            const on = i < filled;
            return (
              <div key={i}
                className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                  on
                    ? 'bg-primary border-primary text-primary-foreground shadow-[0_0_12px_hsl(var(--primary)/0.6)]'
                    : 'border-dashed border-primary/30 text-primary/30 bg-background/40'
                }`}>
                {on ? <Check className="w-4 h-4" /> : <Star className="w-4 h-4" />}
              </div>
            );
          })}
        </div>

        {completed && pendingCount > 0 ? (
          <button onClick={() => setModal(resgates.find(r => r.status === 'pendente') || null)}
            className="flex items-center gap-2 text-sm text-primary font-bold underline">
            <Gift className="w-4 h-4" />
            Você tem um prêmio pronto para resgatar! Toque aqui.
          </button>
        ) : phone.length < 8 ? (
          <p className="text-xs text-muted-foreground">
            Informe seu telefone no checkout para começar a acumular carimbos.
          </p>
        ) : (
          <p className="text-sm text-foreground/80">
            Você tem <span className="text-primary font-bold">{filled} de {meta}</span> carimbos.
            Faltam apenas <span className="text-primary font-bold">{remaining}</span> pedido{remaining > 1 ? 's' : ''} acima de{' '}
            <span className="text-primary font-bold">{formatCurrency(config.valor_minimo_pedido)}</span> para resgatar:{' '}
            <span className="text-primary font-bold">{config.premio_recompensa}</span>.
          </p>
        )}
      </div>

      {/* Prize Modal */}
      {modal && (
        <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in" onClick={dismissModal}>
          <div className="relative bg-card border border-primary/40 rounded-3xl max-w-sm w-full overflow-hidden shadow-[0_30px_80px_-20px_hsl(var(--primary)/0.6)]"
            onClick={e => e.stopPropagation()}>
            <button onClick={dismissModal} className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-background/80 flex items-center justify-center text-foreground">
              <X className="w-4 h-4" />
            </button>
            {modal.premio_imagem ? (
              <img src={modal.premio_imagem} alt={modal.premio_texto} className="w-full h-56 object-cover" />
            ) : (
              <div className="w-full h-56 bg-gradient-to-br from-primary/30 via-primary/10 to-background flex items-center justify-center">
                <Trophy className="w-24 h-24 text-primary" />
              </div>
            )}
            <div className="p-6 space-y-4 text-center">
              <div className="text-xs uppercase tracking-widest text-primary font-bold">🎉 Prêmio liberado</div>
              <h3 className="text-2xl font-bold text-foreground">{modal.premio_texto}</h3>
              {config.descricao_premio && (
                <p className="text-sm text-muted-foreground">{config.descricao_premio}</p>
              )}
              <div className="bg-primary/10 border border-primary/30 rounded-xl p-4">
                <div className="text-xs text-muted-foreground">Mostre este código ao atendente</div>
                <div className="text-2xl font-mono font-bold text-primary tracking-widest mt-1">{modal.codigo_resgate}</div>
              </div>
              <button onClick={dismissModal}
                className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold">
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setHistoryOpen(false)}>
          <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-bold flex items-center gap-2"><HistoryIcon className="w-4 h-4 text-primary"/> Meus Prêmios</h3>
              <button onClick={() => setHistoryOpen(false)} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><X className="w-4 h-4"/></button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {resgates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Nenhum prêmio ainda. Continue pedindo para acumular!</p>
              ) : resgates.map(r => (
                <div key={r.id} className={`flex items-center gap-3 p-3 rounded-xl border ${r.status === 'pendente' ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30 opacity-70'}`}>
                  <div className="w-12 h-12 rounded-lg bg-background overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {r.premio_imagem ? <img src={r.premio_imagem} className="w-full h-full object-cover" alt=""/> : <Gift className="w-5 h-5 text-primary"/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{r.premio_texto}</div>
                    <div className="text-xs font-mono text-primary">{r.codigo_resgate}</div>
                    <div className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleDateString('pt-BR')}</div>
                  </div>
                  {r.status === 'pendente' ? (
                    <button onClick={() => { setHistoryOpen(false); setModal(r); }}
                      className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg font-semibold">Ver</button>
                  ) : (
                    <span className="text-xs text-success font-semibold flex items-center gap-1"><Check className="w-3 h-3"/>Usado</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LoyaltyCard;
