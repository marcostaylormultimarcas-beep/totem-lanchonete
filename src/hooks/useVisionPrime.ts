import { useCallback, useEffect, useRef, useState } from 'react';
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

const INACTIVE_STATUS: VisionPrimeStatus = { active: false };

/** Configuração pública do Vision Prime da loja. */
export function useVisionPrimeConfig(orgId: string | null, enabled = true) {
  const [config, setConfig] = useState<VisionPrimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedOrgIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!orgId || !enabled) {
      loadedOrgIdRef.current = null;
      setConfig(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const load = async () => {
      try {
        const { data, error } = await supabase
          .rpc('vision_prime_public_config', { _org: orgId })
          .maybeSingle();

        if (cancelled) return;

        loadedOrgIdRef.current = orgId;
        if (error) {
          console.warn('[vision-prime] public config error:', error);
          setConfig(null);
          return;
        }

        setConfig((data as VisionPrimeConfig | null) || null);
      } catch (error) {
        if (cancelled) return;
        loadedOrgIdRef.current = orgId;
        console.warn('[vision-prime] public config request failed:', error);
        setConfig(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [orgId, enabled]);

  const isCurrent = Boolean(orgId && enabled && loadedOrgIdRef.current === orgId);

  return {
    config: isCurrent ? config : null,
    loading: Boolean(orgId && enabled) && (!isCurrent || loading),
  };
}

/** Status da assinatura do usuário autenticado para esta loja. */
export function useVisionPrimeStatus(orgId: string | null, enabled = true) {
  const [status, setStatus] = useState<VisionPrimeStatus>(INACTIVE_STATUS);
  const [loading, setLoading] = useState(true);
  const loadedOrgIdRef = useRef<string | null>(null);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;

    if (!orgId || !enabled) {
      loadedOrgIdRef.current = null;
      setStatus(INACTIVE_STATUS);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (requestVersion !== requestVersionRef.current) return;
      if (authError) throw authError;

      if (!user) {
        loadedOrgIdRef.current = orgId;
        setStatus(INACTIVE_STATUS);
        return;
      }

      const { data, error } = await supabase.rpc('vision_prime_my_status', { _org: orgId });
      if (requestVersion !== requestVersionRef.current) return;
      if (error) throw error;

      const result = (data || {}) as { active?: boolean; since_year?: number };
      loadedOrgIdRef.current = orgId;
      setStatus({
        active: Boolean(result.active),
        sinceYear: result.since_year,
      });
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return;

      loadedOrgIdRef.current = orgId;
      console.warn('[vision-prime] membership status error:', error);
      setStatus(INACTIVE_STATUS);
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setLoading(false);
      }
    }
  }, [orgId, enabled]);

  useEffect(() => {
    void refresh();

    return () => {
      requestVersionRef.current += 1;
    };
  }, [refresh]);

  const isCurrent = Boolean(orgId && enabled && loadedOrgIdRef.current === orgId);

  return {
    status: isCurrent ? status : INACTIVE_STATUS,
    loading: Boolean(orgId && enabled) && (!isCurrent || loading),
    refresh,
  };
}
