import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Crown, Loader2, Save, Sparkles, DollarSign, Percent, Truck } from 'lucide-react';

interface PrimeConfig {
  ativo: boolean;
  valor_mensalidade: number;
  desconto_percentual: number;
  frete_gratis_minimo: number;
}

const DEFAULT: PrimeConfig = {
  ativo: false,
  valor_mensalidade: 19.9,
  desconto_percentual: 10,
  frete_gratis_minimo: 0,
};

const VisionPrimePanel = ({ organizationId }: { organizationId: string | null }) => {
  const [cfg, setCfg] = useState<PrimeConfig>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subscribers, setSubscribers] = useState<number>(0);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const [{ data: row }, { count }] = await Promise.all([
        supabase.from('vision_prime_config' as any)
          .select('ativo, valor_mensalidade, desconto_percentual, frete_gratis_minimo')
          .eq('organization_id', organizationId).maybeSingle(),
        supabase.from('vision_prime_assinaturas' as any)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId).eq('status', 'active'),
      ]);
      setCfg(row ? { ...DEFAULT, ...(row as any) } : DEFAULT);
      setSubscribers(count || 0);
      setLoading(false);
    })();
  }, [organizationId]);

  const save = async () => {
    if (!organizationId) return;
    setSaving(true);
    const payload = { organization_id: organizationId, ...cfg };
    const { error } = await supabase.from('vision_prime_config' as any)
      .upsert(payload as any, { onConflict: 'organization_id' });
    setSaving(false);
    if (error) { toast.error('Erro: ' + error.message); return; }
    toast.success('Vision Prime atualizado!');
  };

  if (loading) {
    return <div className="px-4 py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="px-4 space-y-4 max-w-3xl">
      <div className="rounded-2xl p-5 border-2 border-[#d4a04c]/50"
        style={{ background: 'linear-gradient(135deg, #1a1208 0%, #2b1d09 50%, #0d0a05 100%)' }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#f6c560,#d4881e)' }}>
            <Crown className="w-6 h-6 text-black" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight" style={{ color: '#f4d28b' }}>Vision Prime</h2>
            <p className="text-xs text-amber-100/70">Clube de assinatura premium da sua loja</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] uppercase tracking-wider text-amber-100/60">Assinantes</p>
            <p className="text-2xl font-black text-amber-200">{subscribers}</p>
          </div>
        </div>
      </div>

      <div className="kiosk-card p-5 space-y-5">
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="font-bold flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#d4a04c]" /> Clube ativo</p>
            <p className="text-xs text-muted-foreground">Quando ligado, o cliente vê a opção e os benefícios são aplicados no checkout.</p>
          </div>
          <input type="checkbox" checked={cfg.ativo}
            onChange={e => setCfg({ ...cfg, ativo: e.target.checked })}
            className="w-6 h-6 accent-[#d4a04c]" />
        </label>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-amber-100/60 mb-1 block">Mensalidade</label>
            <div className="relative">
              <DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-400/70" />
              <input type="number" step="0.10" min={0} value={cfg.valor_mensalidade}
                onChange={e => setCfg({ ...cfg, valor_mensalidade: Number(e.target.value) || 0 })}
                className="w-full pl-9 pr-3 py-3 bg-zinc-950/60 border border-zinc-800 rounded-lg outline-none focus:ring-2 focus:ring-[#d4a04c] text-zinc-100" />
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-amber-100/60 mb-1 block">Desconto fixo</label>
            <div className="relative">
              <Percent className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-400/70" />
              <input type="number" step="1" min={0} max={100} value={cfg.desconto_percentual}
                onChange={e => setCfg({ ...cfg, desconto_percentual: Number(e.target.value) || 0 })}
                className="w-full pl-9 pr-3 py-3 bg-zinc-950/60 border border-zinc-800 rounded-lg outline-none focus:ring-2 focus:ring-[#d4a04c] text-zinc-100" />
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-amber-100/60 mb-1 block">Frete grátis a partir de</label>
            <div className="relative">
              <Truck className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-400/70" />
              <input type="number" step="1" min={0} value={cfg.frete_gratis_minimo}
                onChange={e => setCfg({ ...cfg, frete_gratis_minimo: Number(e.target.value) || 0 })}
                className="w-full pl-9 pr-3 py-3 bg-zinc-950/60 border border-zinc-800 rounded-lg outline-none focus:ring-2 focus:ring-[#d4a04c] text-zinc-100" />
            </div>
            <p className="text-[10px] text-amber-100/50 mt-1">Use 0 para sempre conceder frete grátis aos Prime.</p>
          </div>
        </div>

        <button onClick={save} disabled={saving}
          className="w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 text-black"
          style={{ background: 'linear-gradient(135deg,#f6c560,#d4881e)' }}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar configurações
        </button>
      </div>

      <div className="rounded-xl border border-[#d4a04c]/30 bg-[#d4a04c]/5 p-4 text-xs text-amber-100/80">
        💡 Benefícios automáticos quando o cliente é Prime: desconto fixo no subtotal e frete grátis (acima do mínimo configurado). Um selo dourado aparece no carrinho e perfil do assinante.
      </div>
    </div>
  );
};

export default VisionPrimePanel;
