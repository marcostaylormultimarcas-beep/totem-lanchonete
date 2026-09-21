import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Tag, Loader2, Store, ShieldCheck, RefreshCw, Gift } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';
import { getKioskHomePath } from '@/lib/kioskHome';
import { labelCategoria } from '@/lib/categorias';

interface PartnerCoupon {
  org: { id: string; name: string; slug: string; logo_url: string; categoria: string };
  cupons: { id: string; codigo: string; tipo: string; valor: number }[];
}

const ClubeVantagens = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const orgId = useOrgId();
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [origemCat, setOrigemCat] = useState<string>('');
  const [origemNome, setOrigemNome] = useState<string>('');
  const [data, setData] = useState<PartnerCoupon[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const goBack = () => {
    if (location.key !== 'default') {
      navigate(-1);
      return;
    }
    navigate(getKioskHomePath());
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setAuthed(false); setLoading(false); return; }
        setAuthed(true);

        const { data: catalog, error } = await supabase.rpc('clube_vantagens_catalog' as any, {
        _fallback_org: orgId,
      });
        if (error) throw error;

        const result = catalog as any;
        if (!result?.ok) throw new Error('club_catalog_unavailable');

        setOrigemCat(result.origem_categoria || 'outro');
        setOrigemNome(result.origem_nome || '');
        const grouped: PartnerCoupon[] = ((result.partners || []) as any[]).map(p => ({
          org: {
            id: p.partner_id,
            name: p.partner_name,
            slug: p.partner_slug,
            logo_url: p.logo_url || '',
            categoria: p.categoria || 'outro',
          },
          cupons: p.cupons || [],
        }));
        setData(grouped);
      } catch (error) {
        console.error('Clube de Vantagens:', error);
        setData([]);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [orgId, reloadKey]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={goBack} className="text-muted-foreground hover:text-foreground" aria-label="Voltar">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h1 className="font-black text-lg">Clube de Vantagens</h1>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-4 space-y-4 pb-20">
        <section className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-5 sm:p-6 overflow-hidden relative">
          <div className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-primary/10 blur-2xl" />
          <div className="relative flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
              <Gift className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Benefícios exclusivos</p>
              <h2 className="text-xl sm:text-2xl font-black mt-1">Vantagens para quem compra com a gente</h2>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Cupons e ofertas de parceiros selecionados, reunidos em um só lugar.
              </p>
            </div>
          </div>
        </section>

        {loading && (
          <div className="space-y-3" aria-busy="true">
            <div className="kiosk-card p-5">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <div>
                  <p className="font-bold">Carregando seus benefícios</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Só um instante enquanto buscamos as ofertas disponíveis.</p>
                </div>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {[0, 1].map(item => (
                <div key={item} className="kiosk-card p-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-2/3 rounded bg-muted" />
                      <div className="h-3 w-1/3 rounded bg-muted" />
                    </div>
                  </div>
                  <div className="h-10 rounded-xl bg-muted mt-4" />
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && authed === false && (
          <div className="kiosk-card p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 mx-auto flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>
            <div>
              <p className="font-black text-lg">Entre para ver suas vantagens</p>
              <p className="text-sm text-muted-foreground mt-1">Sua conta libera os cupons disponíveis para você.</p>
            </div>
            <button onClick={() => navigate('/auth?returnTo=/clube')} className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-bold">Entrar no Clube</button>
          </div>
        )}

        {!loading && authed && loadError && (
          <div className="kiosk-card p-7 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-muted mx-auto flex items-center justify-center">
              <RefreshCw className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-black text-lg">Não foi possível carregar agora</p>
              <p className="text-sm text-muted-foreground mt-1">Sua conta está normal. Tente novamente em alguns instantes.</p>
            </div>
            <button onClick={() => setReloadKey(v => v + 1)} className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-bold inline-flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Tentar novamente
            </button>
          </div>
        )}

        {!loading && authed && !loadError && (
          <>
            {data.length > 0 && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex gap-3 items-start">
                <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-bold">Seleção exclusiva {origemNome && <>via <span className="text-primary">{origemNome}</span></>}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    As ofertas são organizadas para complementar sua experiência de compra.
                  </p>
                </div>
              </div>
            )}

            {data.length === 0 ? (
              <div className="kiosk-card p-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 mx-auto flex items-center justify-center">
                  <Store className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <p className="font-black text-lg">Nenhum benefício disponível agora</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                    Quando a loja publicar novos parceiros e cupons, eles aparecerão aqui automaticamente.
                  </p>
                </div>
                <button onClick={goBack} className="border border-border bg-muted/50 px-5 py-2.5 rounded-xl font-bold hover:bg-muted transition">
                  Voltar ao cardápio
                </button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {data.map(g => (
                  <div key={g.org.id} className="kiosk-card p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      {g.org.logo_url ? (
                        <img src={g.org.logo_url} alt={g.org.name} className="w-12 h-12 rounded-xl object-cover border border-border/60" />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center font-bold text-muted-foreground">{g.org.name.slice(0,2).toUpperCase()}</div>
                      )}
                      <div className="min-w-0">
                        <p className="font-bold truncate">{g.org.name}</p>
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{labelCategoria(g.org.categoria)}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {g.cupons.map(c => (
                        <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Tag className="w-4 h-4 text-primary shrink-0" />
                            <span className="font-bold text-sm truncate">{c.codigo}</span>
                          </div>
                          <span className="text-xs font-bold text-primary shrink-0">
                            {c.tipo === 'percentual' ? `${c.valor}% OFF` : `R$ ${Number(c.valor).toFixed(2)} OFF`}
                          </span>
                        </div>
                      ))}
                    </div>
                    <a
                      href={`/loja/${g.org.slug}`}
                      className="block text-center text-xs font-bold text-primary hover:underline"
                    >Visitar loja →</a>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ClubeVantagens;
