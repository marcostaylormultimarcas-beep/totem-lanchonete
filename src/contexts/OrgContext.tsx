import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useStoreTheme } from '@/hooks/useStoreTheme';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  paused: boolean;
  owner_id?: string | null;
}

interface OrgContextValue {
  orgId: string | null;
  org: Organization | null;
  loading: boolean;
  lockedSlug: string | null;
  setOrgId: (id: string) => Promise<void>;
  lockToSlug: (slug: string | null) => Promise<void>;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = 'kiosk_org_id';

const OrgContext = createContext<OrgContextValue>({
  orgId: null,
  org: null,
  loading: true,
  lockedSlug: null,
  setOrgId: async () => {},
  lockToSlug: async () => {},
  refresh: async () => {},
});

export const useOrg = () => useContext(OrgContext);
export const useOrgId = () => useContext(OrgContext).orgId;

export const OrgProvider = ({ children }: { children: ReactNode }) => {
  const [orgId, setOrgIdState] = useState<string | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [lockedSlug, setLockedSlug] = useState<string | null>(null);
  const lockedSlugRef = useRef<string | null>(null);

  const applyOrg = (data: Organization) => {
    setOrgIdState(data.id);
    setOrg(data);
  };

  const setOrgId = async (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    const { data } = await supabase.from('organizations').select('*').eq('id', id).maybeSingle();
    if (data) applyOrg(data as Organization);
  };

  const lockToSlug = async (slug: string | null) => {
    lockedSlugRef.current = slug;
    setLockedSlug(slug);
    if (!slug) return;
    localStorage.setItem('kiosk_slug', slug);
    const { data } = await supabase.from('organizations').select('*').eq('slug', slug).maybeSingle();
    if (data) {
      localStorage.setItem(STORAGE_KEY, data.id);
      applyOrg(data as Organization);
    }
  };

  const resolve = async () => {
    setLoading(true);

    // 0. Slug travado pela URL /loja/:slug sempre vence
    if (lockedSlugRef.current) {
      const { data } = await supabase.from('organizations').select('*').eq('slug', lockedSlugRef.current).maybeSingle();
      if (data) {
        localStorage.setItem(STORAGE_KEY, data.id);
        applyOrg(data as Organization);
        setLoading(false);
        return;
      }
    }

    // 1. Usuário autenticado: org do dono
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: ownOrg } = await supabase
        .from('organizations')
        .select('*')
        .eq('owner_id', user.id)
        .maybeSingle();
      if (ownOrg) {
        localStorage.setItem(STORAGE_KEY, ownOrg.id);
        applyOrg(ownOrg as Organization);
        setLoading(false);
        return;
      }
    }
    // 2. localStorage (totem público)
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const { data } = await supabase.from('organizations').select('*').eq('id', stored).maybeSingle();
      if (data) {
        applyOrg(data as Organization);
        setLoading(false);
        return;
      }
    }
    // 3. primeira org disponível (fallback)
    const { data } = await supabase.from('organizations').select('*').order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (data) {
      localStorage.setItem(STORAGE_KEY, data.id);
      applyOrg(data as Organization);
    }
    setLoading(false);
  };

  useEffect(() => {
    resolve();
    const { data: sub } = supabase.auth.onAuthStateChange((_event) => {
      resolve();
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  return (
    <OrgContext.Provider value={{ orgId, org, loading, lockedSlug, setOrgId, lockToSlug, refresh: resolve }}>
      {children}
    </OrgContext.Provider>
  );
};

export const KioskSlugSync = ({ children }: { children: ReactNode }) => {
  const { slug } = useParams<{ slug: string }>();
  const normalizedSlug = slug?.trim().toLowerCase() || '';
  const { lockToSlug, orgId } = useOrg();
  const [ready, setReady] = useState(false);
  const [found, setFound] = useState<boolean | null>(null);

  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const sync = async () => {
      setReady(false);
      setFound(null);
      setPaused(false);
      await lockToSlug(normalizedSlug || null);
      if (normalizedSlug) {
        const { data } = await supabase
          .from('organizations')
          .select('id, paused')
          .eq('slug', normalizedSlug)
          .maybeSingle();
        setFound(!!data?.id);
        setPaused(!!data?.paused);
      } else {
        setFound(false);
      }
      setReady(true);
    };
    sync();
    return () => {
      lockToSlug(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedSlug]);

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando loja...</div>;
  }
  if (found === false && normalizedSlug) {
    return <Navigate to={`/loja/${normalizedSlug}/home`} replace />;
  }
  if (paused) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-background text-center">
        <div className="max-w-md space-y-4">
          <div className="text-6xl">🚧</div>
          <h1 className="text-2xl font-black">Estabelecimento indisponível</h1>
          <p className="text-muted-foreground text-sm">
            Esta loja está temporariamente pausada. Tente novamente mais tarde ou entre em contato com o estabelecimento.
          </p>
        </div>
      </div>
    );
  }
  if (!orgId) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando loja...</div>;
  }
  return <>{children}</>;
};

