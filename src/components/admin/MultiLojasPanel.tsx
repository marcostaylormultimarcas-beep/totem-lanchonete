import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';
import {
  Loader2, Building2, DollarSign, ShoppingBag, TrendingUp, Trophy, AlertTriangle,
  PackageX, Crown, ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  paused: boolean;
}

interface OrderRow {
  organization_id: string;
  total: number;
  status: string;
  created_at: string;
}

interface LowStockRow {
  id: string;
  organization_id: string;
  name: string;
  stock_quantity: number;
  low_stock_threshold: number;
}

const daysAgoISO = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

const MultiLojasPanel = ({ tier, userId }: { tier: 'master' | 'super'; userId: string }) => {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());

  const orgsById = useMemo(() => {
    const m = new Map<string, OrgRow>();
    orgs.forEach(o => m.set(o.id, o));
    return m;
  }, [orgs]);

  // 1) Load orgs scoped to tier
  useEffect(() => {
    const load = async () => {
      let q = supabase.from('organizations').select('id, name, slug, logo_url, paused').order('name');
      if (tier === 'master') q = q.eq('master_id', userId);
      const { data } = await q;
      setOrgs((data as any) || []);
    };
    load();
  }, [tier, userId]);

  // 2) Load orders + low-stock for those orgs
  useEffect(() => {
    if (orgs.length === 0) { setOrders([]); setLowStock([]); setLoading(false); return; }
    const ids = orgs.map(o => o.id);
    const run = async () => {
      setLoading(true);
      const fromDate = new Date(from + 'T00:00:00').toISOString();
      const toDate = new Date(to + 'T23:59:59').toISOString();

      const [{ data: ord }, { data: prods }] = await Promise.all([
        supabase.from('orders')
          .select('organization_id, total, status, created_at')
          .in('organization_id', ids)
          .gte('created_at', fromDate)
          .lte('created_at', toDate)
          .neq('status', 'cancelled'),
        (supabase.from('products') as any)
          .select('id, organization_id, name, stock_quantity, low_stock_threshold, manage_stock')
          .in('organization_id', ids)
          .eq('manage_stock', true),
      ]);

      setOrders((ord as any) || []);
      const low = ((prods as any[]) || []).filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold));
      low.sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity));
      setLowStock(low as any);
      setLoading(false);
    };
    run();
  }, [orgs, from, to]);

  // Aggregates
  const totals = useMemo(() => {
    let receita = 0;
    let pedidos = 0;
    const byOrg = new Map<string, { receita: number; pedidos: number }>();
    orders.forEach(o => {
      receita += Number(o.total || 0);
      pedidos += 1;
      const cur = byOrg.get(o.organization_id) || { receita: 0, pedidos: 0 };
      cur.receita += Number(o.total || 0);
      cur.pedidos += 1;
      byOrg.set(o.organization_id, cur);
    });
    const ranking = Array.from(byOrg.entries())
      .map(([id, v]) => ({ id, ...v, org: orgsById.get(id) }))
      .sort((a, b) => b.receita - a.receita);
    const ticketMedio = pedidos > 0 ? receita / pedidos : 0;
    return { receita, pedidos, ranking, ticketMedio };
  }, [orders, orgsById]);

  const maxReceita = totals.ranking[0]?.receita || 1;
  const rupturas = useMemo(() => lowStock.filter(p => p.stock_quantity <= 0), [lowStock]);
  const setPreset = (d: number) => { setFrom(daysAgoISO(d)); setTo(todayISO()); };

  return (
    <div className="px-4 space-y-4">
      {/* Header */}
      <div className="kiosk-card p-4 bg-gradient-to-r from-amber-500/10 via-yellow-500/5 to-transparent border-l-4 border-amber-500">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
            <Crown className="w-6 h-6 text-amber-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-black bg-gradient-to-r from-amber-300 to-yellow-500 bg-clip-text text-transparent">
              Painel Multi-Lojas
            </h2>
            <p className="text-xs text-muted-foreground">
              Visão consolidada de toda a rede · {orgs.length} loja{orgs.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Período */}
      <div className="kiosk-card p-4 space-y-3">
        <div className="flex gap-2 flex-wrap">
          {[0, 7, 30, 90].map(d => (
            <button key={d} onClick={() => setPreset(d)}
              className="px-3 py-2 rounded-lg bg-muted text-xs hover:bg-amber-500 hover:text-background transition">
              {d === 0 ? 'Hoje' : `${d} dias`}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">De</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-amber-500 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Até</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-amber-500 text-sm" />
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="kiosk-card p-4 space-y-1 border-l-4 border-success">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
            <DollarSign className="w-3.5 h-3.5 text-success" /> Faturamento
          </div>
          <p className="text-xl font-black text-success">{formatCurrency(totals.receita)}</p>
        </div>
        <div className="kiosk-card p-4 space-y-1 border-l-4 border-primary">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
            <ShoppingBag className="w-3.5 h-3.5 text-primary" /> Pedidos
          </div>
          <p className="text-xl font-black text-primary">{totals.pedidos}</p>
        </div>
        <div className="kiosk-card p-4 space-y-1 border-l-4 border-amber-500">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
            <TrendingUp className="w-3.5 h-3.5 text-amber-400" /> Ticket Médio
          </div>
          <p className="text-xl font-black text-amber-300">{formatCurrency(totals.ticketMedio)}</p>
        </div>
        <div className={`kiosk-card p-4 space-y-1 border-l-4 ${rupturas.length ? 'border-destructive' : 'border-muted'}`}>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
            <AlertTriangle className={`w-3.5 h-3.5 ${rupturas.length ? 'text-destructive' : 'text-muted-foreground'}`} /> Rupturas
          </div>
          <p className={`text-xl font-black ${rupturas.length ? 'text-destructive' : 'text-foreground'}`}>{rupturas.length}</p>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
        </div>
      )}

      {/* Ranking */}
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" /> Ranking de Lojas (no período)
        </h3>
        {totals.ranking.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-6">Sem vendas no período selecionado.</p>
        ) : (
          <div className="space-y-2">
            {totals.ranking.map((r, i) => {
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
              const pct = (r.receita / maxReceita) * 100;
              return (
                <div key={r.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-black text-amber-400 w-8 text-center">{medal}</span>
                    {r.org?.logo_url ? (
                      <img src={r.org.logo_url} alt="" className="w-7 h-7 rounded-md object-cover ring-1 ring-amber-500/30" />
                    ) : (
                      <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center">
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                    )}
                    <span className="font-semibold truncate flex-1">{r.org?.name || '—'}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {r.pedidos} ped · <span className="text-success font-bold">{formatCurrency(r.receita)}</span>
                    </span>
                    {r.org?.slug && (
                      <Link to={`/loja/${r.org.slug}`} target="_blank" className="text-muted-foreground hover:text-amber-400">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-400" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Alertas de ruptura na rede */}
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <PackageX className="w-4 h-4 text-destructive" /> Alertas de Estoque na Rede
        </h3>
        {lowStock.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">✅ Nenhum produto com baixo estoque na rede.</p>
        ) : (
          <div className="space-y-1">
            {lowStock.slice(0, 30).map(p => {
              const org = orgsById.get(p.organization_id);
              const esgotado = p.stock_quantity <= 0;
              return (
                <div key={p.id} className="flex items-center gap-2 text-sm py-1.5 border-b border-border/40 last:border-0">
                  {org?.logo_url ? (
                    <img src={org.logo_url} alt="" className="w-6 h-6 rounded object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded bg-muted flex items-center justify-center">
                      <Building2 className="w-3 h-3 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{org?.name || '—'}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${esgotado ? 'bg-destructive/20 text-destructive' : 'bg-amber-500/20 text-amber-400'}`}>
                    {esgotado ? 'Esgotado' : `${p.stock_quantity} restante${p.stock_quantity !== 1 ? 's' : ''}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MultiLojasPanel;
