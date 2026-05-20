import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/contexts/OrgContext';

interface PlanFeatureRow {
  enabled: boolean;
  features: { key: string } | null;
}

/**
 * Carrega o conjunto de feature keys habilitadas para a organização atual.
 * Atualiza em tempo real via Realtime (plan_features e organizations).
 */
export function usePlanFeatures() {
  const { org } = useOrg();
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [planKey, setPlanKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const planId = (org as any)?.plan_id as string | undefined;
    if (!org) { setEnabled(new Set()); setLoading(false); return; }
    if (!planId) { setEnabled(new Set()); setLoading(false); return; }

    const load = async () => {
      setLoading(true);
      const [{ data: plan }, { data: rows }] = await Promise.all([
        supabase.from('plans' as any).select('key').eq('id', planId).maybeSingle(),
        supabase.from('plan_features' as any)
          .select('enabled, features:feature_id(key)')
          .eq('plan_id', planId),
      ]);
      if (!active) return;
      setPlanKey((plan as any)?.key ?? null);
      const set = new Set<string>();
      (rows as unknown as PlanFeatureRow[] | null)?.forEach(r => {
        if (r.enabled && r.features?.key) set.add(r.features.key);
      });
      setEnabled(set);
      setLoading(false);
    };
    load();

    const ch = supabase
      .channel(`plan-features-${planId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_features', filter: `plan_id=eq.${planId}` }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [org]);

  return {
    loading,
    planKey,
    has: (key: string) => enabled.has(key),
    enabledKeys: enabled,
  };
}
