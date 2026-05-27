import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Tag, Loader2, Store, ShieldCheck } from 'lucide-react';
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
  const orgId = useOrgId();
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [origemCat, setOrigemCat] = useState<string>('');
  const [origemNome, setOrigemNome] = useState<string>('');
  const [data, setData] = useState<PartnerCoupon[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setAuthed(false); setLoading(false); return; }
      setAuthed(true);

      const { data: profile } = await supabase
        .from('profiles')
        .select('origem_assinatura_empresa_id')
        .eq('user_id', session.user.id)
        .maybeSingle();

      const origemId = (profile as any)?.origem_assinatura_empresa_id || orgId;
      if (!origemId) { setLoading(false); return; }

      const { data: origemOrg } = await supabase
        .from('organizations').select('id,name,categoria').eq('id', origemId).maybeSingle();
      const cat = (origemOrg as any)?.categoria || 'outro';
      setOrigemCat(cat);
      setOrigemNome((origemOrg as any)?.name || '');

      const { data: parcerias } = await supabase
        .from('parcerias' as any)
        .select('org_origem,org_parceira,status,habilitada_origem,habilitada_parceira')
        .or(`org_origem.eq.${origemId},org_parceira.eq.${origemId}`)
        .eq('status', 'active');

      const partnerIds = (parcerias || [])
        .filter((p: any) => p.habilitada_origem && p.habilitada_parceira)
        .map((p: any) => (p.org_origem === origemId ? p.org_parceira : p.org_origem));

      if (partnerIds.length === 0) { setData([]); setLoading(false); return; }

      const { data: orgs } = await supabase
        .from('organizations')
        .select('id,name,slug,logo_url,categoria')
        .in('id', partnerIds);

      // 🔒 Proteção de nicho — exclui parceiros da mesma categoria da loja de origem.
      const allowed = ((orgs as any[]) || []).filter(o => (o.categoria || 'outro') !== cat);
      if (allowed.length === 0) { setData([]); setLoading(false); return; }

      const { data: cupons } = await supabase
        .from('cupons')
        .select('id,codigo,tipo,valor,status,organization_id')
        .in('organization_id', allowed.map(o => o.id))
        .eq('status', 'ativo');

      const grouped: PartnerCoupon[] = allowed.map(o => ({
        org: o as any,
        cupons: ((cupons as any[]) || []).filter(c => c.organization_id === o.id),
      })).filter(g => g.cupons.length > 0);

      setData(grouped);
      setLoading(false);
    };
    load();
  }, [orgId]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(getKioskHomePath())} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h1 className="font-black text-lg">Clube de Vantagens</h1>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-4 space-y-4 pb-16">
        {authed === false && (
          <div className="kiosk-card p-6 text-center space-y-3">
            <p className="font-bold">Faça login para acessar seus cupons exclusivos.</p>
            <button onClick={() => navigate('/auth?returnTo=/clube')} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg font-bold">Entrar</button>
          </div>
        )}

        {authed && (
          <>
            <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 to-transparent p-4 flex gap-3 items-start">
              <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-bold">Cupons exclusivos da rede {origemNome && <>via <span className="text-primary">{origemNome}</span></>}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Proteção de nicho ativa: nada da categoria <span className="font-semibold">{labelCategoria(origemCat)}</span> aparece aqui.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : data.length === 0 ? (
              <div className="kiosk-card p-8 text-center text-muted-foreground">
                <Store className="w-10 h-10 mx-auto mb-2 opacity-60" />
                <p className="font-bold text-foreground">Ainda não há parceiros ativos</p>
                <p className="text-xs mt-1">Volte em breve — novas lojas estão entrando no clube.</p>
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
