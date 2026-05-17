import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Award, Check, Star, Gift } from 'lucide-react';
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
}

const sanitizePhone = (p: string) => p.replace(/\D/g, '');

const LoyaltyCard = ({ organizationId, customerPhone, className = '' }: Props) => {
  const [config, setConfig] = useState<Config | null>(null);
  const [stamps, setStamps] = useState(0);

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
        });
      });
  }, [organizationId]);

  useEffect(() => {
    const phone = sanitizePhone(customerPhone);
    if (!organizationId || !phone || phone.length < 8) { setStamps(0); return; }
    let cancelled = false;
    supabase.from('progresso_fidelidade' as any)
      .select('quantidade_carimbos')
      .eq('organization_id', organizationId)
      .eq('telefone_cliente', phone)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setStamps(Number((data as any)?.quantidade_carimbos) || 0); });

    const channel = supabase
      .channel(`fid-${organizationId}-${phone}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'progresso_fidelidade', filter: `organization_id=eq.${organizationId}` },
        (payload: any) => {
          const row = payload.new || payload.old;
          if (row?.telefone_cliente === phone) {
            setStamps(Number(payload.new?.quantidade_carimbos) || 0);
          }
        })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [organizationId, customerPhone]);

  if (!config?.ativo) return null;

  const meta = Math.max(1, config.meta_pedidos);
  const filled = Math.min(stamps, meta);
  const remaining = Math.max(0, meta - filled);
  const completed = remaining === 0;

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-br from-card via-card to-primary/10 p-5 shadow-[0_8px_30px_-12px_hsl(var(--primary)/0.5)] ${className}`}>
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-primary/20 blur-2xl pointer-events-none" />
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <Award className="w-5 h-5 text-primary" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-primary font-semibold">Cartão Fidelidade</div>
          <div className="text-sm text-foreground font-bold">{config.premio_recompensa}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 my-4">
        {Array.from({ length: meta }).map((_, i) => {
          const on = i < filled;
          return (
            <div
              key={i}
              className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                on
                  ? 'bg-primary border-primary text-primary-foreground shadow-[0_0_12px_hsl(var(--primary)/0.6)]'
                  : 'border-dashed border-primary/30 text-primary/30 bg-background/40'
              }`}
            >
              {on ? <Check className="w-4 h-4" /> : <Star className="w-4 h-4" />}
            </div>
          );
        })}
      </div>

      {completed ? (
        <div className="flex items-center gap-2 text-sm text-primary font-bold">
          <Gift className="w-4 h-4" />
          Parabéns! Você completou o cartão. Avise o atendente para resgatar: {config.premio_recompensa}
        </div>
      ) : sanitizePhone(customerPhone).length < 8 ? (
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
  );
};

export default LoyaltyCard;
