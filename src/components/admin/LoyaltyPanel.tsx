import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Award, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Config {
  id?: string;
  ativo: boolean;
  meta_pedidos: number;
  valor_minimo_pedido: number;
  premio_recompensa: string;
}

const DEFAULT: Config = {
  ativo: false,
  meta_pedidos: 10,
  valor_minimo_pedido: 30,
  premio_recompensa: 'Ganhe um brinde especial',
};

const LoyaltyPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    supabase
      .from('config_fidelidade' as any)
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const d = data as any;
          setConfig({
            id: d.id,
            ativo: !!d.ativo,
            meta_pedidos: Number(d.meta_pedidos) || 10,
            valor_minimo_pedido: Number(d.valor_minimo_pedido) || 0,
            premio_recompensa: d.premio_recompensa || '',
          });
        } else {
          setConfig(DEFAULT);
        }
        setLoading(false);
      });
  }, [organizationId]);

  const save = async () => {
    if (!organizationId) return;
    if (config.meta_pedidos < 1) { toast.error('Meta deve ser ao menos 1.'); return; }
    if (!config.premio_recompensa.trim()) { toast.error('Informe o prêmio.'); return; }
    setSaving(true);
    const payload = {
      organization_id: organizationId,
      ativo: config.ativo,
      meta_pedidos: config.meta_pedidos,
      valor_minimo_pedido: config.valor_minimo_pedido,
      premio_recompensa: config.premio_recompensa.trim(),
    };
    let error;
    if (config.id) {
      ({ error } = await supabase.from('config_fidelidade' as any).update(payload).eq('id', config.id));
    } else {
      const res = await supabase.from('config_fidelidade' as any).insert(payload).select().maybeSingle();
      error = res.error;
      if (res.data) setConfig(c => ({ ...c, id: (res.data as any).id }));
    }
    setSaving(false);
    if (error) toast.error('Erro ao salvar: ' + error.message);
    else toast.success('Cartão Fidelidade atualizado!');
  };

  if (!organizationId) return <div className="p-4 text-muted-foreground">Selecione uma loja.</div>;
  if (loading) return <div className="p-4 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin"/> Carregando…</div>;

  return (
    <div className="px-4 space-y-4">
      <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center">
            <Award className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Cartão Fidelidade</h2>
            <p className="text-xs text-muted-foreground">Personalize as regras do seu programa de fidelidade.</p>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 bg-muted/40 rounded-xl px-4 py-3 cursor-pointer">
          <div>
            <div className="text-sm font-semibold text-foreground">Programa ativo</div>
            <div className="text-xs text-muted-foreground">Quando ativo, os clientes veem o cartão na loja.</div>
          </div>
          <input
            type="checkbox"
            className="w-12 h-7 appearance-none rounded-full bg-muted relative cursor-pointer transition-colors checked:bg-primary
              before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-6 before:h-6 before:bg-background before:rounded-full before:transition-transform
              checked:before:translate-x-5"
            checked={config.ativo}
            onChange={e => setConfig(c => ({ ...c, ativo: e.target.checked }))}
          />
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Carimbos para completar o cartão</label>
            <input
              type="number"
              min={1}
              value={config.meta_pedidos}
              onChange={e => setConfig(c => ({ ...c, meta_pedidos: parseInt(e.target.value) || 0 }))}
              className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Valor mínimo do pedido (R$)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={config.valor_minimo_pedido}
              onChange={e => setConfig(c => ({ ...c, valor_minimo_pedido: parseFloat(e.target.value) || 0 }))}
              className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Texto da recompensa</label>
          <input
            type="text"
            maxLength={120}
            placeholder="Ex: Ganhe um X-Burger Grátis"
            value={config.premio_recompensa}
            onChange={e => setConfig(c => ({ ...c, premio_recompensa: e.target.value }))}
            className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground"
          />
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar configurações
        </button>
      </div>
    </div>
  );
};

export default LoyaltyPanel;
