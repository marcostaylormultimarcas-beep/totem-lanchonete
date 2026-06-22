import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, X } from 'lucide-react';
import { daysUntil } from '@/lib/validade';

interface Item {
  id: string;
  name: string;
  table: 'products' | 'ingredientes';
  days: number;
}

interface Props {
  organizationId: string | null;
  thresholdDays?: number;
}

const DISMISS_KEY = 'venc_banner_dismiss';

const VencimentoBanner = ({ organizationId, thresholdDays = 7 }: Props) => {
  const [items, setItems] = useState<Item[]>([]);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      const v = sessionStorage.getItem(DISMISS_KEY);
      return v === '1';
    } catch { return false; }
  });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!organizationId) { setItems([]); return; }
    let cancelled = false;
    const load = async () => {
      const [{ data: prods }, { data: ings }] = await Promise.all([
        (supabase.from('products') as any)
          .select('id, name, data_vencimento, alerta_vencimento')
          .eq('organization_id', organizationId)
          .eq('alerta_vencimento', true)
          .not('data_vencimento', 'is', null),
        (supabase.from('ingredientes') as any)
          .select('id, nome, data_vencimento, alerta_vencimento')
          .eq('organization_id', organizationId)
          .eq('alerta_vencimento', true)
          .not('data_vencimento', 'is', null),
      ]);
      if (cancelled) return;
      const all: Item[] = [];
      ((prods as any[]) || []).forEach(p => {
        const d = daysUntil(p.data_vencimento);
        if (d !== null && d <= thresholdDays) all.push({ id: p.id, name: p.name, table: 'products', days: d });
      });
      ((ings as any[]) || []).forEach(p => {
        const d = daysUntil(p.data_vencimento);
        if (d !== null && d <= thresholdDays) all.push({ id: p.id, name: p.nome, table: 'ingredientes', days: d });
      });
      all.sort((a, b) => a.days - b.days);
      setItems(all);
    };
    load();
    return () => { cancelled = true; };
  }, [organizationId, thresholdDays]);

  if (dismissed || items.length === 0) return null;

  const vencidos = items.filter(i => i.days < 0).length;
  const proximos = items.length - vencidos;

  return (
    <div className="px-4 pt-2">
      <div className="kiosk-card border-l-4 border-amber-500 bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent p-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-400 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-amber-300">
              ⚠️ Atenção: {items.length} {items.length === 1 ? 'item próximo' : 'itens próximos'} do vencimento
              {vencidos > 0 && <span className="text-destructive"> · {vencidos} vencido{vencidos !== 1 ? 's' : ''}</span>}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {proximos > 0 ? `${proximos} a vencer em até ${thresholdDays} dias. ` : ''}
              <button onClick={() => setExpanded(e => !e)} className="text-amber-400 underline hover:text-amber-300">
                {expanded ? 'ocultar lista' : 'ver lista'}
              </button>
            </p>
            {expanded && (
              <ul className="mt-2 space-y-1 max-h-40 overflow-auto">
                {items.slice(0, 30).map(i => (
                  <li key={`${i.table}:${i.id}`} className="flex items-center justify-between text-[11px] py-0.5 border-b border-border/40 last:border-0">
                    <span className="truncate">
                      <span className="text-muted-foreground">{i.table === 'products' ? '🍔' : '🧂'}</span>{' '}
                      <span className="font-semibold">{i.name}</span>
                    </span>
                    <span className={`font-bold whitespace-nowrap ${i.days < 0 ? 'text-destructive' : 'text-amber-400'}`}>
                      {i.days < 0 ? `vencido há ${Math.abs(i.days)}d` : i.days === 0 ? 'vence hoje' : `${i.days}d`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            onClick={() => { try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch {} setDismissed(true); }}
            className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0"
            title="Dispensar até o próximo login"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default VencimentoBanner;
