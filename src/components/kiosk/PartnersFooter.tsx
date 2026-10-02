import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Partner { id: string; name: string; logo_url: string; categoria: string; slug: string; }

const PartnersFooter = ({ orgId }: { orgId: string | null }) => {
  const [partners, setPartners] = useState<Partner[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setPartners([]); return; }

      const { data: catalog, error } = await supabase.rpc('clube_vantagens_catalog' as any, {
        _fallback_org: orgId,
      });
      if (error || !(catalog as any)?.ok) {
        if (!cancelled) setPartners([]);
        return;
      }

      const list = (((catalog as any).partners || []) as any[]).map(p => ({
        id: p.partner_id,
        name: p.partner_name,
        slug: p.partner_slug,
        logo_url: p.logo_url || '',
        categoria: p.categoria || 'outro',
      }));
      if (!cancelled) setPartners(list);
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
                <img src={p.logo_url} alt={p.name} loading="lazy" className="w-11 h-11 rounded-xl object-cover border border-border/60 bg-muted" />
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
