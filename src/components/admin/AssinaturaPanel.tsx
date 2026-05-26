import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Crown, Check, X, Loader2, Sparkles, ArrowRightLeft, CreditCard, ShieldAlert, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface Plan { id: string; key: string; name: string; description: string; sort_order: number; }
interface Feature { id: string; key: string; name: string; description: string; category: string; sort_order: number; }
interface PlanFeatureRow { plan_id: string; feature_id: string; enabled: boolean; }

interface Props { organizationId: string | null; }

const AssinaturaPanel = ({ organizationId }: Props) => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [matrix, setMatrix] = useState<Record<string, boolean>>({});
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [statusAssinatura, setStatusAssinatura] = useState<string>('ativo');
  const [valorPlano, setValorPlano] = useState<number>(197);
  const [loading, setLoading] = useState(true);
  const [showChange, setShowChange] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const [{ data: org }, { data: ps }, { data: fs }, { data: pfs }, { data: sys }] = await Promise.all([
      supabase.from('organizations').select('plan_id, status_assinatura').eq('id', organizationId).maybeSingle(),
      supabase.from('plans' as any).select('*').order('sort_order'),
      supabase.from('features' as any).select('*').order('sort_order'),
      supabase.from('plan_features' as any).select('plan_id, feature_id, enabled'),
      supabase.from('system_settings').select('valor_plano_padrao').eq('id', 'global').maybeSingle(),
    ]);
    setCurrentPlanId((org as any)?.plan_id ?? null);
    setStatusAssinatura((org as any)?.status_assinatura ?? 'ativo');
    setPlans((ps as any) || []);
    setFeatures((fs as any) || []);
    setValorPlano(Number((sys as any)?.valor_plano_padrao ?? 197));
    const map: Record<string, boolean> = {};
    (pfs as unknown as PlanFeatureRow[] | null)?.forEach(r => { map[`${r.plan_id}:${r.feature_id}`] = r.enabled; });
    setMatrix(map);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [organizationId]);

  // Realtime: caso o Super Master altere a matriz ou outro admin mude o plano
  useEffect(() => {
    if (!organizationId) return;
    const ch = supabase
      .channel(`assinatura-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_features' }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'organizations', filter: `id=eq.${organizationId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [organizationId]);

  const currentPlan = plans.find(p => p.id === currentPlanId) || null;

  const featuresForPlan = (planId: string | null) =>
    planId
      ? features.filter(f => matrix[`${planId}:${f.id}`])
      : [];

  const changePlan = async (newPlanId: string) => {
    if (!organizationId) return;
    if (newPlanId === currentPlanId) { setShowChange(false); return; }
    setSaving(true);
    const { error } = await supabase.from('organizations').update({ plan_id: newPlanId } as any).eq('id', organizationId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Plano alterado com sucesso!');
    setShowChange(false);
    await load();
  };

  if (!organizationId) {
    return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Selecione uma loja.</div>;
  }
  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const liberadas = featuresForPlan(currentPlanId);
  const todasOrdenadas = [...features].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="px-4 space-y-4">
      <div className="kiosk-card p-5 space-y-3 border-2 border-primary/30">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center flex-shrink-0">
              <Crown className="w-6 h-6 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Plano atual</p>
              <h2 className="text-xl font-black truncate">{currentPlan?.name || 'Sem plano'}</h2>
              {currentPlan?.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{currentPlan.description}</p>
              )}
            </div>
          </div>
          <button onClick={() => setShowChange(true)}
            className="touch-btn flex-shrink-0 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-1.5 hover:opacity-90">
            <ArrowRightLeft className="w-4 h-4" /> Alterar
          </button>
        </div>
      </div>

      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" /> Benefícios incluídos
          <span className="text-xs text-muted-foreground font-normal ml-auto">{liberadas.length} de {features.length}</span>
        </h3>
        {!currentPlanId ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum plano atribuído à sua loja. Fale com o suporte.</p>
        ) : (
          <ul className="space-y-1.5">
            {todasOrdenadas.map(f => {
              const on = !!matrix[`${currentPlanId}:${f.id}`];
              return (
                <li key={f.id} className={`flex items-start gap-2.5 p-2 rounded-lg ${on ? '' : 'opacity-50'}`}>
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${on ? 'bg-success/20 text-success border border-success/40' : 'bg-muted text-muted-foreground border border-border'}`}>
                    {on ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{f.name}</p>
                    {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showChange && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-md flex items-center justify-center p-4" onClick={() => !saving && setShowChange(false)}>
          <div className="kiosk-card max-w-lg w-full max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-black text-lg flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-primary" /> Escolha um plano
              </h3>
              <button onClick={() => !saving && setShowChange(false)} className="p-1.5 rounded-lg hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Compare os planos abaixo e clique para alterar. A mudança é aplicada imediatamente.</p>
            <div className="space-y-2">
              {plans.map(p => {
                const isCurrent = p.id === currentPlanId;
                const feats = featuresForPlan(p.id);
                return (
                  <button key={p.id} onClick={() => !saving && !isCurrent && changePlan(p.id)} disabled={saving || isCurrent}
                    className={`w-full text-left p-3 rounded-xl border-2 transition ${
                      isCurrent
                        ? 'border-primary bg-primary/10 cursor-default'
                        : 'border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/60'
                    }`}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="font-black text-sm uppercase">{p.name}</p>
                      {isCurrent && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-bold">ATUAL</span>}
                      {saving && !isCurrent && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                    </div>
                    {p.description && <p className="text-xs text-muted-foreground mb-2">{p.description}</p>}
                    <div className="flex items-center gap-1.5 text-xs">
                      <Check className="w-3.5 h-3.5 text-success" />
                      <span className="font-semibold">{feats.length}</span>
                      <span className="text-muted-foreground">funcionalidades incluídas</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssinaturaPanel;
