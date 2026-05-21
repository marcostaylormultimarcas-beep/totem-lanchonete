import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Globe2, Loader2 } from 'lucide-react';

interface Row {
  id: string; status: string; min_order_value: number; discount_percent: number;
  org_origem: string; org_parceira: string;
  origem_name?: string; parceira_name?: string;
  origem_city?: string; parceira_city?: string;
}

const CoMarketingGlobalMap = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('parcerias' as any).select('*').order('updated_at', { ascending: false });
      const list = (data || []) as any as Row[];
      const ids = Array.from(new Set(list.flatMap(r => [r.org_origem, r.org_parceira])));
      if (ids.length) {
        const { data: orgs } = await supabase.from('organizations').select('id,name,city').in('id', ids);
        const map = new Map((orgs || []).map((o: any) => [o.id, o]));
        list.forEach(r => {
          const a: any = map.get(r.org_origem); const b: any = map.get(r.org_parceira);
          r.origem_name = a?.name; r.origem_city = a?.city;
          r.parceira_name = b?.name; r.parceira_city = b?.city;
        });
      }
      setRows(list);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="px-4 py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;

  const byCity = new Map<string, Row[]>();
  rows.forEach(r => {
    const city = r.origem_city || r.parceira_city || 'Sem cidade';
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city)!.push(r);
  });

  return (
    <div className="px-4 space-y-4 max-w-4xl pb-10">
      <div className="kiosk-card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><Globe2 className="w-5 h-5 text-primary" /></div>
        <div>
          <h2 className="font-black text-lg">Mapa Global de Parcerias</h2>
          <p className="text-xs text-muted-foreground">{rows.length} parcerias registradas em {byCity.size} cidade(s).</p>
        </div>
      </div>

      {Array.from(byCity.entries()).map(([city, list]) => (
        <section key={city} className="kiosk-card p-4">
          <h3 className="font-bold mb-2">📍 {city} <span className="text-xs text-muted-foreground font-normal">({list.length})</span></h3>
          <div className="space-y-1.5">
            {list.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm border-b border-border last:border-0 pb-1.5">
                <div className="min-w-0">
                  <p className="truncate"><b>{r.origem_name}</b> → <b>{r.parceira_name}</b></p>
                  <p className="text-xs text-muted-foreground">Min R$ {Number(r.min_order_value).toFixed(2)} · Cupom {r.discount_percent}%</p>
                </div>
                <span className={`text-xs uppercase font-bold ${r.status === 'active' ? 'text-success' : r.status === 'pending' ? 'text-yellow-500' : r.status === 'suspended' ? 'text-destructive' : 'text-muted-foreground'}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default CoMarketingGlobalMap;
