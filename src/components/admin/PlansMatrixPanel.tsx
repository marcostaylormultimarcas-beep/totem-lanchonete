import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Layers, History, Check, X, ShieldCheck, User as UserIcon, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface Plan { id: string; key: string; name: string; description: string; sort_order: number; }
interface Feature { id: string; key: string; name: string; description: string; category: string; sort_order: number; }
interface MatrixRow { plan_id: string; feature_id: string; enabled: boolean; }
interface AuditRow {
  id: string;
  actor_email: string;
  plan_name: string; plan_key: string;
  feature_name: string; feature_key: string;
  action: string;
  previous_value: boolean | null;
  new_value: boolean | null;
  created_at: string;
}

const SUPER_MASTER_EMAIL = 'marcostaylor2020@gmail.com';

const PlansMatrixPanel = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [matrix, setMatrix] = useState<Record<string, boolean>>({}); // key = `${planId}:${featureId}`
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [tab, setTab] = useState<'grid' | 'audit'>('grid');
  const [currentEmail, setCurrentEmail] = useState<string>('');

  const canWrite = currentEmail.toLowerCase() === SUPER_MASTER_EMAIL;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentEmail(data.user?.email || ''));
  }, []);

  const loadAll = async () => {
    setLoading(true);
    const [{ data: p }, { data: f }, { data: m }] = await Promise.all([
      supabase.from('plans' as any).select('*').order('sort_order'),
      supabase.from('features' as any).select('*').order('sort_order'),
      supabase.from('plan_features' as any).select('plan_id, feature_id, enabled'),
    ]);
    setPlans((p as any) || []);
    setFeatures((f as any) || []);
    const map: Record<string, boolean> = {};
    (m as unknown as MatrixRow[] | null)?.forEach(r => { map[`${r.plan_id}:${r.feature_id}`] = r.enabled; });
    setMatrix(map);
    setLoading(false);
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    const { data } = await supabase.from('plan_audit_log' as any)
      .select('*').order('created_at', { ascending: false }).limit(100);
    setAudit((data as any) || []);
    setAuditLoading(false);
  };

  useEffect(() => { loadAll(); loadAudit(); }, []);

  // Realtime: matriz + auditoria
  useEffect(() => {
    const ch = supabase
      .channel('plans-matrix-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_features' }, () => loadAll())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plan_audit_log' }, () => loadAudit())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const toggle = async (plan: Plan, feature: Feature, current: boolean) => {
    if (!canWrite) {
      toast.error('Apenas o Super Master pode alterar a Matriz Global de Planos.');
      return;
    }
    const cellKey = `${plan.id}:${feature.id}`;
    setSavingKey(cellKey);
    // optimistic
    setMatrix(prev => ({ ...prev, [cellKey]: !current }));
    const { data, error } = await supabase.rpc('toggle_plan_feature' as any, {
      _plan_id: plan.id, _feature_id: feature.id, _enabled: !current,
    });
    setSavingKey(null);
    if (error || (data as any)?.ok === false) {
      // revert
      setMatrix(prev => ({ ...prev, [cellKey]: current }));
      toast.error((data as any)?.reason || error?.message || 'Erro ao alterar');
      return;
    }
    toast.success(`${feature.name} ${!current ? 'liberada' : 'bloqueada'} para ${plan.name}`);
  };

  const groupedFeatures = useMemo(() => {
    const g: Record<string, Feature[]> = {};
    features.forEach(f => { (g[f.category] = g[f.category] || []).push(f); });
    return g;
  }, [features]);

  return (
    <div className="px-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-base flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary" /> Gestão de Planos
        </h2>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <button onClick={() => setTab('grid')}
            className={`text-xs px-3 py-1.5 rounded-md font-semibold ${tab === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
            Matriz
          </button>
          <button onClick={() => setTab('audit')}
            className={`text-xs px-3 py-1.5 rounded-md font-semibold flex items-center gap-1 ${tab === 'audit' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
            <History className="w-3.5 h-3.5" /> Auditoria
          </button>
        </div>
      </div>

      {tab === 'grid' && (
        loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <>
          {!canWrite && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs p-3 flex items-start gap-2">
              <Lock className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">Modo somente leitura</p>
                <p className="opacity-80">Apenas o Super Master ({SUPER_MASTER_EMAIL}) pode editar a Matriz Global de Funcionalidades. Você pode visualizar a configuração atual e o histórico de auditoria.</p>
              </div>
            </div>
          )}
          <div className="kiosk-card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-left p-3 font-bold sticky left-0 bg-muted/60 z-10 min-w-[220px]">Funcionalidade</th>
                    {plans.map(p => (
                      <th key={p.id} className="p-3 text-center min-w-[110px]">
                        <div className="font-black text-xs uppercase">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground font-normal mt-0.5">{p.description}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(groupedFeatures).map(([cat, feats]) => (
                    <>
                      <tr key={`cat-${cat}`} className="bg-muted/20">
                        <td colSpan={plans.length + 1} className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold text-muted-foreground">{cat}</td>
                      </tr>
                      {feats.map(f => (
                        <tr key={f.id} className="border-t border-border/50">
                          <td className="p-3 sticky left-0 bg-card z-10">
                            <div className="font-semibold">{f.name}</div>
                            {f.description && <div className="text-[11px] text-muted-foreground">{f.description}</div>}
                          </td>
                          {plans.map(p => {
                            const cellKey = `${p.id}:${f.id}`;
                            const on = !!matrix[cellKey];
                            const busy = savingKey === cellKey;
                            return (
                              <td key={p.id} className="p-3 text-center">
                                <button
                                  onClick={() => !busy && toggle(p, f, on)}
                                  disabled={busy || !canWrite}
                                  className={`w-9 h-9 rounded-lg border-2 flex items-center justify-center mx-auto transition ${
                                    on
                                      ? 'bg-primary border-primary text-primary-foreground'
                                      : 'bg-muted border-border text-muted-foreground hover:border-primary/50'
                                  } ${busy ? 'opacity-50' : ''} ${!canWrite ? 'cursor-not-allowed opacity-70' : ''}`}
                                  title={!canWrite ? 'Somente o Super Master pode editar' : (on ? 'Clique para bloquear' : 'Clique para liberar')}
                                >
                                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (on ? <Check className="w-5 h-5" /> : <X className="w-4 h-4" />)}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 text-[11px] text-muted-foreground border-t border-border/50 flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-success" />
              Alterações são aplicadas em tempo real para todas as lojas do plano.
            </div>
          </div>
          </>
        )
      )}

      {tab === 'audit' && (
        <div className="kiosk-card p-0 overflow-hidden">
          <div className="p-3 border-b border-border/50 flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-sm">Histórico de Alterações</h3>
            <span className="text-[11px] text-muted-foreground ml-auto">Últimas 100</span>
          </div>
          {auditLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : audit.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">Nenhuma alteração registrada ainda.</p>
          ) : (
            <div className="divide-y divide-border/50">
              {audit.map(a => (
                <div key={a.id} className="p-3 flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    a.action === 'enabled' ? 'bg-success/15 text-success border border-success/30' : 'bg-destructive/15 text-destructive border border-destructive/30'
                  }`}>
                    {a.action === 'enabled' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <strong>{a.feature_name}</strong>{' '}
                      {a.action === 'enabled' ? 'liberada' : 'bloqueada'} para o{' '}
                      <strong>{a.plan_name}</strong>
                    </p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <UserIcon className="w-3 h-3" />
                      {a.actor_email || 'sistema'}
                      <span>·</span>
                      {new Date(a.created_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PlansMatrixPanel;
