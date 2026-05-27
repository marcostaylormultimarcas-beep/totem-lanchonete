import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Partner { id: string; name: string; logo_url: string; categoria: string; slug: string; }

/**
 * Rodapé com os parceiros do Clube de Vantagens disponíveis para o cliente logado.
 * Aplica a proteção de nicho: exclui qualquer parceiro com a mesma categoria
 * da loja de origem do cliente (origem_assinatura_empresa_id em profiles).
 */
const PartnersFooter = ({ orgId }: { orgId: string | null }) => {
  const [partners, setPartners] = useState<Partner[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setPartners([]); return; }

      // Loja de origem do cliente
      const { data: profile } = await supabase
        .from('profiles')
        .select('origem_assinatura_empresa_id')
        .eq('user_id', session.user.id)
        .maybeSingle();
      const origemId = (profile as any)?.origem_assinatura_empresa_id || orgId;
      if (!origemId) { setPartners([]); return; }

      const { data: origemOrg } = await supabase
        .from('organizations').select('id,categoria').eq('id', origemId).maybeSingle();
      const origemCat = (origemOrg as any)?.categoria || 'outro';

      // Parcerias ativas conectadas à loja de origem
      const { data: parcerias } = await supabase
        .from('parcerias' as any)
        .select('org_origem,org_parceira,status,habilitada_origem,habilitada_parceira')
        .or(`org_origem.eq.${origemId},org_parceira.eq.${origemId}`)
        .eq('status', 'active');

      const partnerIds = (parcerias || [])
        .filter((p: any) => p.habilitada_origem && p.habilitada_parceira)
        .map((p: any) => (p.org_origem === origemId ? p.org_parceira : p.org_origem));

      if (partnerIds.length === 0) { setPartners([]); return; }

      const { data: orgs } = await supabase
        .from('organizations')
        .select('id,name,slug,logo_url,categoria')
        .in('id', partnerIds);

      const filtered = ((orgs as any[]) || []).filter(o => (o.categoria || 'outro') !== origemCat);
      if (!cancelled) setPartners(filtered as Partner[]);
    };
    load();
    return () => { cancelled = true; };
  }, [orgId]);

  if (partners.length === 0) return null;

  return (
    <footer className="mt-10 border-t border-border/60 bg-card/40 backdrop-blur-sm px-4 py-5">
      <div className="max-w-5xl mx-auto">
        <p className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          Parceiros do nosso Clube de Vantagens
        </p>
        <div className="flex items-center gap-3 overflow-x-auto pb-1">
          {partners.map(p => (
            <div key={p.id} className="flex flex-col items-center gap-1 shrink-0">
              {p.logo_url ? (
                <img
                  src={p.logo_url} alt={p.name} loading="lazy"
                  className="w-11 h-11 rounded-xl object-cover border border-border/60 bg-muted"
                />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-muted border border-border/60 flex items-center justify-center text-xs font-bold text-muted-foreground">
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="text-[10px] text-muted-foreground max-w-[64px] truncate">{p.name}</span>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
};

export default PartnersFooter;
