import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useStoreTheme } from '@/hooks/useStoreTheme';
import { fetchPublicOrganization, type PublicOrganization } from '@/lib/publicOrganization';

export type Organization = PublicOrganization;

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
    const data = await fetchPublicOrganization({ id });
    if (data) applyOrg(data);
  };

  const lockToSlug = async (slug: string | null) => {
    lockedSlugRef.current = slug;
    setLockedSlug(slug);
    if (!slug) return;
    localStorage.setItem('kiosk_slug', slug);
    const data = await fetchPublicOrganization({ slug });
    if (data) {
      localStorage.setItem(STORAGE_KEY, data.id);
      applyOrg(data);
    }
  };

  const resolve = async () => {
    setLoading(true);

    try {
      // 0. Slug travado pela URL /loja/:slug sempre vence
      if (lockedSlugRef.current) {
        const data = await fetchPublicOrganization({ slug: lockedSlugRef.current });
        if (data) {
          localStorage.setItem(STORAGE_KEY, data.id);
          applyOrg(data);
          return;
        }
      }

      // O totem físico nunca depende de auth de cliente/dono para descobrir a loja.
      // Em cold-start offline, usa somente o último snapshot público já sincronizado.
      const isPhysicalKioskRoute =
        typeof window !== 'undefined' && window.location.pathname.startsWith('/cardapio/');
      if (isPhysicalKioskRoute) {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            const data = await fetchPublicOrganization({ id: stored });
            if (data) applyOrg(data);
          } catch (error) {
            console.warn('[OrgContext] cached kiosk organization unavailable:', error);
          }
        }
        return;
      }

      // 1. Usuário autenticado: org do dono
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: ownOrg, error: ownOrgError } = await supabase
          .from('organizations')
          .select('id')
          .eq('owner_id', user.id)
          .maybeSingle();
        if (ownOrgError) throw ownOrgError;
        if (ownOrg?.id) {
          const ownPublicOrg = await fetchPublicOrganization({ id: ownOrg.id });
          if (ownPublicOrg) {
            localStorage.setItem(STORAGE_KEY, ownPublicOrg.id);
            applyOrg(ownPublicOrg);
            return;
          }
        }
      }

      // 2. localStorage (totem público)
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = await fetchPublicOrganization({ id: stored });
        if (data) {
          applyOrg(data);
          return;
        }
      }

      // 3. primeira org disponível (fallback)
      const data = await fetchPublicOrganization();
      if (data) {
        localStorage.setItem(STORAGE_KEY, data.id);
        applyOrg(data);
      }
    } catch (error) {
      console.error('[OrgContext] organization resolution failed:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    resolve();
    const { data: sub } = supabase.auth.onAuthStateChange((_event) => {
      setTimeout(() => {
        resolve();
      }, 0);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  // Aplica o tema da loja (cores e modo) sempre que a org mudar
  useStoreTheme(orgId);

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
  const [syncError, setSyncError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      setReady(false);
      setFound(null);
      setPaused(false);
      setSyncError(null);

      try {
        await lockToSlug(normalizedSlug || null);
        if (cancelled) return;

        if (normalizedSlug) {
          const data = await fetchPublicOrganization({ slug: normalizedSlug });
          if (cancelled) return;
          setFound(!!data?.id);
          setPaused(!!data?.paused);
        } else {
          setFound(false);
        }
      } catch (error) {
        console.error('[KioskSlugSync] store resolution failed:', error);
        if (!cancelled) {
          setSyncError('Não foi possível carregar esta loja agora.');
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    void sync();
    return () => {
      cancelled = true;
      void lockToSlug(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedSlug, retryKey]);

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando loja...</div>;
  }
  if (syncError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-background text-center">
        <div className="max-w-md space-y-4">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-xl font-black">Não foi possível carregar a loja</h1>
          <p className="text-muted-foreground text-sm">{syncError}</p>
          <button
            type="button"
            onClick={() => setRetryKey(value => value + 1)}
            className="touch-btn bg-primary text-primary-foreground px-4 py-3 rounded-xl font-semibold"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
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

