import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, TrendingDown, AlertTriangle, ShoppingCart, Loader2, Sparkles, Calendar } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { triggerPredictiveStockAlert } from '@/lib/onesignal';

/* =========================================================
 * IA de Estoque Preditivo — Previsão de Compras
 * ---------------------------------------------------------
 * - Lê pedidos (últimos 30 dias) + receitas + ingredientes
 * - Calcula consumo diário por ingrediente
 * - Separa dia de semana vs final de semana (peso 5/2)
 * - Projeta dias restantes; marca "Risco de Ruptura"
 * - Dispara push OneSignal (tag tipo=admin) p/ alto giro
 * =======================================================*/

interface Ingrediente { id: string; nome: string; unidade: string; estoque_atual: number; estoque_minimo: number; }
interface Receita { product_id: string; ingrediente_id: string; quantidade: number; }
interface OrderRow { created_at: string; items: any; status: string; }

interface ConsumoDia { date: string; total: number; weekend: boolean; }
interface SugestaoCompra {
  ingrediente: Ingrediente;
  mediaDia: number;
  mediaSemana: number;
  mediaFimDeSemana: number;
  diasRestantes: number;
  recomendado: number;
  risco: 'critico' | 'alto' | 'medio' | 'ok';
  serie: { date: string; consumo: number; projecao?: number }[];
}

const COBERTURA_DIAS = 14; // alvo de cobertura recomendada
const RISCO_DIAS = 3;      // limiar para push preditivo

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => { const w = d.getDay(); return w === 0 || w === 6; };

const EstoquePreditivPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [loading, setLoading] = useState(true);
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([]);
  const [sugestoes, setSugestoes] = useState<SugestaoCompra[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const pushedRef = useRef<Set<string>>(new Set());

  const carregar = async () => {
    if (!organizationId) return;
    setLoading(true);

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [{ data: ingRows }, { data: recRows }, { data: ordRows }] = await Promise.all([
      supabase.from('ingredientes').select('id,nome,unidade,estoque_atual,estoque_minimo').eq('organization_id', organizationId),
      supabase.from('receitas').select('product_id,ingrediente_id,quantidade').eq('organization_id', organizationId),
      supabase.from('orders').select('created_at,items,status').eq('organization_id', organizationId).gte('created_at', since.toISOString()).neq('status', 'cancelled'),
    ]);

    const ings = (ingRows as Ingrediente[]) || [];
    const recs = (recRows as Receita[]) || [];
    const orders = (ordRows as OrderRow[]) || [];

    setIngredientes(ings);

    // index: product_id -> [{ingId, qtd}]
    const byProduct = new Map<string, { ingId: string; qtd: number }[]>();
    for (const r of recs) {
      const arr = byProduct.get(r.product_id) || [];
      arr.push({ ingId: r.ingrediente_id, qtd: Number(r.quantidade) || 0 });
      byProduct.set(r.product_id, arr);
    }

    // ingId -> Map<date, totalConsumo>
    const consumoPorIng = new Map<string, Map<string, number>>();

    for (const o of orders) {
      const items = Array.isArray(o.items) ? o.items : [];
      const dia = fmtDate(new Date(o.created_at));
      for (const it of items as any[]) {
        const pid = it?.product_id || it?.product?.id || it?.id;
        const qty = Number(it?.quantity || 1);
        if (!pid) continue;
        const receitas = byProduct.get(pid);
        if (!receitas) continue;
        for (const r of receitas) {
          const totalIng = r.qtd * qty;
          let m = consumoPorIng.get(r.ingId);
          if (!m) { m = new Map(); consumoPorIng.set(r.ingId, m); }
          m.set(dia, (m.get(dia) || 0) + totalIng);
        }
      }
    }

    // últimos 14 dias para gráfico
    const dias: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      dias.push(fmtDate(d));
    }

    const novasSugestoes: SugestaoCompra[] = ings.map(ing => {
      const map = consumoPorIng.get(ing.id) || new Map<string, number>();
      const serieFull: ConsumoDia[] = dias.map(d => ({ date: d, total: map.get(d) || 0, weekend: isWeekend(new Date(d + 'T12:00:00')) }));

      const semana = serieFull.filter(s => !s.weekend);
      const fds = serieFull.filter(s => s.weekend);
      const mediaSemana = semana.length ? semana.reduce((a, b) => a + b.total, 0) / semana.length : 0;
      const mediaFds = fds.length ? fds.reduce((a, b) => a + b.total, 0) / fds.length : 0;
      const mediaDia = (mediaSemana * 5 + mediaFds * 2) / 7;

      const diasRestantes = mediaDia > 0 ? ing.estoque_atual / mediaDia : Infinity;
      const recomendado = Math.max(0, Math.ceil(mediaDia * COBERTURA_DIAS - ing.estoque_atual));

      let risco: SugestaoCompra['risco'] = 'ok';
      if (diasRestantes <= 1) risco = 'critico';
      else if (diasRestantes <= RISCO_DIAS) risco = 'alto';
      else if (diasRestantes <= 7) risco = 'medio';

      // Projeção: próximos 7 dias = consumo médio (peso fds quando weekend)
      const serie = serieFull.map(s => ({ date: s.date.slice(5), consumo: s.total }));
      let estoqueProj = ing.estoque_atual;
      for (let i = 1; i <= 7; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        const dec = isWeekend(d) ? mediaFds || mediaDia : mediaSemana || mediaDia;
        estoqueProj = Math.max(0, estoqueProj - dec);
        serie.push({ date: fmtDate(d).slice(5), consumo: 0, projecao: Math.max(0, dec) });
      }

      return { ingrediente: ing, mediaDia, mediaSemana, mediaFimDeSemana: mediaFds, diasRestantes, recomendado, risco, serie };
    }).sort((a, b) => a.diasRestantes - b.diasRestantes);

    setSugestoes(novasSugestoes);
    setSelectedId(prev => prev || novasSugestoes[0]?.ingrediente.id || null);
    setUpdatedAt(new Date());
    setLoading(false);

    // 🔔 Push preditivo para itens de alto giro com risco crítico/alto
    for (const s of novasSugestoes) {
      if (s.risco === 'critico' || s.risco === 'alto') {
        if (s.mediaDia < 1) continue; // baixo giro, ignora
        const key = `${s.ingrediente.id}:${Math.ceil(s.diasRestantes)}`;
        if (pushedRef.current.has(key)) continue;
        pushedRef.current.add(key);
        triggerPredictiveStockAlert(s.ingrediente.nome, Math.max(1, Math.ceil(s.diasRestantes)));
      }
    }
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [organizationId]);

  const critico = useMemo(() => sugestoes.find(s => s.risco === 'critico' || s.risco === 'alto') || null, [sugestoes]);
  const selecionada = useMemo(() => sugestoes.find(s => s.ingrediente.id === selectedId) || sugestoes[0], [sugestoes, selectedId]);

  if (loading) {
    return <div className="px-4 py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>;
  }

  if (!organizationId) {
    return <div className="px-4 py-10 text-center text-zinc-500">Selecione uma loja.</div>;
  }

  return (
    <div className="px-4 pb-12 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400/30 to-yellow-600/20 border border-amber-400/40 flex items-center justify-center">
            <Brain className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <h2 className="text-xl font-black text-amber-100 tracking-tight flex items-center gap-2">
              IA de Estoque Preditivo
              <span className="text-[10px] uppercase tracking-widest text-amber-400/80 bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 rounded-full font-bold">Previsão</span>
            </h2>
            <p className="text-xs text-zinc-500">Análise dos últimos 30 dias · peso dia útil 5 / final de semana 2</p>
          </div>
        </div>
        <button onClick={carregar}
          className="touch-btn text-xs font-bold px-3 py-2 rounded-lg bg-amber-400/10 text-amber-200 border border-amber-400/30 hover:bg-amber-400/20">
          <Sparkles className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Recalcular
        </button>
      </div>

      {/* Card crítico */}
      {critico ? (
        <div className={`relative overflow-hidden rounded-2xl border p-5 bg-zinc-900/90 ${critico.risco === 'critico' ? 'border-red-500/60 shadow-[0_0_30px_-8px_rgba(239,68,68,0.5)] animate-pulse' : 'border-amber-400/50'}`}>
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${critico.risco === 'critico' ? 'bg-red-500/20 text-red-300' : 'bg-amber-400/20 text-amber-300'}`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className={`text-[10px] uppercase tracking-widest font-black mb-1 ${critico.risco === 'critico' ? 'text-red-300' : 'text-amber-300'}`}>
                {critico.risco === 'critico' ? 'Risco crítico — ruptura iminente' : 'Atenção — risco de ruptura'}
              </p>
              <p className="text-zinc-100 leading-relaxed">
                Com base nas vendas dos últimos finais de semana, seu estoque de{' '}
                <span className="font-black text-amber-200">{critico.ingrediente.nome}</span>{' '}
                deve acabar em <span className="font-black text-amber-200">
                  {isFinite(critico.diasRestantes) ? `${Math.max(1, Math.ceil(critico.diasRestantes * 24))} horas` : '—'}
                </span>. Sugerimos comprar{' '}
                <span className="font-black text-amber-200">{critico.recomendado} {critico.ingrediente.unidade}</span>.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-500/30 bg-zinc-900/80 p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center justify-center"><Sparkles className="w-4 h-4" /></div>
          <p className="text-sm text-zinc-300">Tudo sob controle — nenhum insumo em risco de ruptura nos próximos dias.</p>
        </div>
      )}

      {/* Gráfico de tendência */}
      <div className="rounded-2xl border border-amber-400/20 bg-zinc-900/90 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-amber-300" />
            <p className="font-bold text-amber-100">Tendência de consumo</p>
          </div>
          {sugestoes.length > 0 && (
            <select
              value={selectedId || ''}
              onChange={e => setSelectedId(e.target.value)}
              className="bg-zinc-950 border border-amber-400/30 text-amber-100 text-xs rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-amber-400/40"
            >
              {sugestoes.map(s => (
                <option key={s.ingrediente.id} value={s.ingrediente.id}>{s.ingrediente.nome}</option>
              ))}
            </select>
          )}
        </div>
        <div className="h-64">
          {selecionada ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={selecionada.serie} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
                <YAxis stroke="#71717a" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: '#09090b', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8, color: '#fef3c7' }}
                  labelStyle={{ color: '#fbbf24', fontWeight: 700 }}
                />
                <ReferenceLine x={selecionada.serie[13]?.date} stroke="#f59e0b" strokeDasharray="2 4" label={{ value: 'hoje', fill: '#fbbf24', fontSize: 10, position: 'top' }} />
                <Line type="monotone" dataKey="consumo" stroke="#fbbf24" strokeWidth={2.5} dot={{ r: 2.5, fill: '#fbbf24' }} name="Consumo real" />
                <Line type="monotone" dataKey="projecao" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Projeção" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Sem dados suficientes.</div>
          )}
        </div>
        {updatedAt && (
          <p className="text-[11px] text-zinc-500 mt-2 flex items-center gap-1"><Calendar className="w-3 h-3" /> Atualizado em {updatedAt.toLocaleTimeString('pt-BR')}</p>
        )}
      </div>

      {/* Tabela de sugestões */}
      <div className="rounded-2xl border border-amber-400/20 bg-zinc-900/90 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <ShoppingCart className="w-4 h-4 text-amber-300" />
          <p className="font-bold text-amber-100">Sugestão de compra</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/60 text-[11px] uppercase tracking-wider text-amber-400/70">
              <tr>
                <th className="text-left px-4 py-2 font-bold">Insumo</th>
                <th className="text-right px-3 py-2 font-bold">Estoque</th>
                <th className="text-right px-3 py-2 font-bold">Média/dia</th>
                <th className="text-right px-3 py-2 font-bold">Dias rest.</th>
                <th className="text-right px-4 py-2 font-bold">Comprar</th>
              </tr>
            </thead>
            <tbody>
              {sugestoes.length === 0 && (
                <tr><td colSpan={5} className="text-center text-zinc-500 py-8">Cadastre ingredientes e receitas para liberar a previsão.</td></tr>
              )}
              {sugestoes.map(s => {
                const cor =
                  s.risco === 'critico' ? 'text-red-300 bg-red-500/10 border-red-500/30' :
                  s.risco === 'alto' ? 'text-amber-300 bg-amber-400/10 border-amber-400/30' :
                  s.risco === 'medio' ? 'text-yellow-200 bg-yellow-400/5 border-yellow-400/20' :
                  'text-emerald-300 bg-emerald-500/5 border-emerald-500/20';
                const tag =
                  s.risco === 'critico' ? 'Ruptura' :
                  s.risco === 'alto' ? 'Risco alto' :
                  s.risco === 'medio' ? 'Acompanhar' : 'OK';
                return (
                  <tr key={s.ingrediente.id} className="border-t border-zinc-800/70 hover:bg-zinc-800/40 cursor-pointer"
                    onClick={() => setSelectedId(s.ingrediente.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-zinc-100">{s.ingrediente.nome}</span>
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${cor}`}>{tag}</span>
                      </div>
                      <p className="text-[11px] text-zinc-500">{s.ingrediente.unidade}</p>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-zinc-200">{Number(s.ingrediente.estoque_atual).toFixed(1)}</td>
                    <td className="px-3 py-3 text-right font-mono text-zinc-300">{s.mediaDia.toFixed(2)}</td>
                    <td className={`px-3 py-3 text-right font-mono font-bold ${s.risco === 'critico' ? 'text-red-300' : s.risco === 'alto' ? 'text-amber-300' : 'text-zinc-200'}`}>
                      {isFinite(s.diasRestantes) ? s.diasRestantes.toFixed(1) : '∞'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-black text-amber-200">{s.recomendado > 0 ? `+${s.recomendado}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default EstoquePreditivPanel;
