import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  paused: boolean;
}

interface OrgContextValue {
  orgId: string | null;
  org: Organization | null;
  loading: boolean;
  setOrgId: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = 'kiosk_org_id';

const OrgContext = createContext<OrgContextValue>({
  orgId: null,
  org: null,
  loading: true,
  setOrgId: async () => {},
  refresh: async () => {},
});

export const useOrg = () => useContext(OrgContext);

/**
 * Hook que retorna apenas o orgId — usado em queries.
 * Retorna null enquanto carrega; consumidores devem aguardar.
 */
export const useOrgId = () => useContext(OrgContext).orgId;

export const OrgProvider = ({ children }: { children: ReactNode }) => {
  const [orgId, setOrgIdState] = useState<string | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOrg = async (id: string) => {
    const { data } = await supabase.from('organizations').select('*').eq('id', id).maybeSingle();
    if (data) setOrg(data as Organization);
  };

  const setOrgId = async (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setOrgIdState(id);
    await loadOrg(id);
  };

  const resolve = async () => {
    setLoading(true);
    // 1. URL slug? (e.g. /loja/:slug) — handled by KioskSlugSync below
    // 2. localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const { data } = await supabase.from('organizations').select('*').eq('id', stored).maybeSingle();
      if (data) {
        setOrgIdState(data.id);
        setOrg(data as Organization);
        setLoading(false);
        return;
      }
    }
    // 3. first available org (fallback)
    const { data } = await supabase.from('organizations').select('*').order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (data) {
      localStorage.setItem(STORAGE_KEY, data.id);
      setOrgIdState(data.id);
      setOrg(data as Organization);
    }
    setLoading(false);
  };

  useEffect(() => { resolve(); }, []);

  return (
    <OrgContext.Provider value={{ orgId, org, loading, setOrgId, refresh: resolve }}>
      {children}
    </OrgContext.Provider>
  );
};

/**
 * Componente para a rota /loja/:slug — sincroniza o orgId com base no slug da URL.
 */
export const KioskSlugSync = ({ children }: { children: ReactNode }) => {
  const { slug } = useParams<{ slug: string }>();
  const { setOrgId } = useOrg();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = async () => {
      if (!slug) { setReady(true); return; }
      const { data } = await supabase.from('organizations').select('*').eq('slug', slug).maybeSingle();
      if (data) await setOrgId(data.id);
      setReady(true);
    };
    sync();
  }, [slug]);

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando loja...</div>;
  return <>{children}</>;
};
