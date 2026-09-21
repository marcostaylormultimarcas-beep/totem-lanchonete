import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Store, UtensilsCrossed, WifiOff } from 'lucide-react';
import {
  CompanionKioskTable,
  getKioskCompanionTables,
} from '@/lib/kioskCompanionClient';

interface TableSelectProps {
  onSelectTable: (table: CompanionKioskTable) => void;
  onBalcony: () => void;
  onBack: () => void;
}

const TableSelect = ({ onSelectTable, onBalcony, onBack }: TableSelectProps) => {
  const [tables, setTables] = useState<CompanionKioskTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await getKioskCompanionTables();
      setTables(result.tables || []);
      setStale(Boolean(result.stale));
    } catch (err) {
      console.warn('[TableSelect] kiosk tables unavailable:', err);
      setError('Não foi possível atualizar as mesas neste momento.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center gap-4 p-4 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground" aria-label="Voltar">
          <ArrowLeft className="w-7 h-7" />
        </button>
        <div className="min-w-0">
          <h2 className="text-xl font-black">Comer no Local</h2>
          <p className="text-xs text-muted-foreground">Escolha onde receber seu pedido</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto w-10 h-10 rounded-xl border border-border flex items-center justify-center disabled:opacity-50"
          aria-label="Atualizar mesas"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 px-5 py-6 max-w-2xl mx-auto w-full space-y-5">
        <button
          onClick={onBalcony}
          className="touch-btn w-full rounded-2xl border-2 border-border bg-card p-5 text-left flex items-center gap-4 hover:border-primary transition"
        >
          <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
            <Store className="w-7 h-7 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-black">Retirar no Balcão</p>
            <p className="text-sm text-muted-foreground">Aguarde sua senha ser chamada.</p>
          </div>
        </button>

        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-black text-lg">Receber na Mesa</h3>
              <p className="text-xs text-muted-foreground">
                Mesas em atendimento continuam disponíveis para novos pedidos.
              </p>
            </div>
          </div>

          {stale && (
            <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              Sem conexão com o servidor. Usando a última lista de mesas sincronizada.
            </div>
          )}

          {error && tables.length === 0 && (
            <div className="mb-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
              {error} Você ainda pode retirar no balcão.
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {tables.map((table) => (
              <button
                key={table.id}
                onClick={() => onSelectTable(table)}
                className="touch-btn min-h-[116px] rounded-2xl border border-border bg-card p-4 text-left hover:border-primary active:scale-[0.99] transition"
              >
                <UtensilsCrossed className="w-6 h-6 text-primary mb-3" />
                <p className="font-black leading-tight">{table.label}</p>
                <span
                  className={`inline-flex mt-2 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${
                    table.in_service
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'bg-success/15 text-success border border-success/30'
                  }`}
                >
                  {table.in_service ? 'Em atendimento' : 'Livre'}
                </span>
              </button>
            ))}
          </div>

          {!loading && !error && tables.length === 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
              Nenhuma mesa ativa cadastrada. Use a opção de retirada no balcão.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TableSelect;
