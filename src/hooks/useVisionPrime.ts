import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VisionPrimeConfig {
  ativo: boolean;
  valor_mensalidade: number;
  desconto_percentual: number;
  frete_gratis_minimo: number;
}

export interface VisionPrimeStatus {
  active: boolean;
  sinceYear?: number;
}

/** Configuração pública do Vision Prime da loja. */
export function useVisionPrimeConfig(orgId: string | null) {
  const [config, setConfig] = useState<VisionPrimeConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setConfig(null); setLoading(false); return; }
    let cancel = false;
    setLoading(true);
    supabase.from('vision_prime_config' as any)
      .select('ativo, valor_mensalidade, desconto_percentual, frete_gratis_minimo')
      .eq('organization_id', orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancel) return;
        setConfig((data as any) || null);
        setLoading(false);
      });
    const ch = supabase
      .channel(`vprime-cfg-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vision_prime_config', filter: `organization_id=eq.${orgId}` },
        (p: any) => { if (p.new) setConfig(p.new); })
      .subscribe();
    return () => { cancel = true; supabase.removeChannel(ch); };
  }, [orgId]);

  return { config, loading };
}

/** Status da assinatura do usuário autenticado para esta loja. */
export function useVisionPrimeStatus(orgId: string | null) {
  const [status, setStatus] = useState<VisionPrimeStatus>({ active: false });
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!orgId) { setStatus({ active: false }); setLoading(false); return; }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setStatus({ active: false }); setLoading(false); return; }
    const { data } = await supabase.rpc('vision_prime_my_status' as any, { _org: orgId });
    const r: any = data || {};
    setStatus({ active: Boolean(r.active), sinceYear: r.since_year });
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [orgId]);

  return { status, loading, refresh };
}
