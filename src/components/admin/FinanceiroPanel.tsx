import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, Download, Loader2, Info, TrendingUp, Wallet } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface Row {
  order_id: string;
  order_number: string;
  created_at: string;
  payment_method: string;
  customer_name: string;
  valor_bruto: number;
  taxa_gateway_valor: number;
  taxa_vision_valor: number;
  valor_liquido_final: number;
}

const PAY_LABEL: Record<string, string> = {
  pix: 'PIX',
  cash: 'Dinheiro',
  terminal: 'Maquininha',
  online: 'Cartão Online',
  outro: 'Outro',
};

const normalizePaymentMethod = (value?: string | null) => {
  const method = String(value || '').trim().toLowerCase();
  if (method === 'cash' || method === 'dinheiro') return 'cash';
  if (method === 'pix') return 'pix';
  if (method === 'terminal' || method === 'maquininha') return 'terminal';
  if (method === 'online' || method === 'cartao_online' || method === 'cartão online') return 'online';
  return method || 'outro';
};

const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const FinanceiroPanel = ({ organizationId }: { organizationId: string | null }) => {
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = `${today.slice(0, 7)}-01`;
  const [start, setStart] = useState(firstDay);
  const [end, setEnd] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [taxaVision, setTaxaVision] = useState(0);
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [cmvByOrder, setCmvByOrder] = useState<Record<string, { cmv: number; complete: boolean }>>({});
  const [calcDetail, setCalcDetail] = useState<{
    method: string;
    bruto: number;
    vision: number;
    liquido: number;
  } | null>(null);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const startIso = new Date(`${start}T00:00:00`).toISOString();
    const endIso = new Date(`${end}T23:59:59.999`).toISOString();
    const [
      { data, error },
      { data: s },
      { data: orderRows, error: ordersError },
      { data: recipeRows, error: recipesError },
      { data: ingredientRows, error: ingredientsError },
      { data: productRows, error: productsError },
    ] = await Promise.all([
      supabase
        .from('v_financeiro_detalhado' as any)
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: false }),
      supabase
        .from('settings')
        .select('taxa_vision_percent')
        .eq('organization_id', organizationId)
        .maybeSingle(),
      supabase
        .from('orders')
        .select('id,items,status')
        .eq('organization_id', organizationId)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .neq('status', 'cancelled'),
      (supabase.from('receitas') as any)
        .select('product_id,produto_id,ingredient_id,ingrediente_id,quantidade')
        .eq('organization_id', organizationId),
      (supabase.from('ingredientes') as any)
        .select('id,custo_unitario')
        .eq('organization_id', organizationId),
      supabase
        .from('products')
        .select('id,cost_price,sold_by_weight')
        .eq('organization_id', organizationId),
    ]);

    if (error) toast.error(error.message);
    setRows((data as any) || []);
    setTaxaVision(Number((s as any)?.taxa_vision_percent || 0));

    if (ordersError || recipesError || ingredientsError || productsError) {
      console.warn('[Financeiro] CMV data unavailable:', ordersError || recipesError || ingredientsError || productsError);
      setCmvByOrder({});
    } else {
      const ingredientCost = new Map<string, number>();
      for (const ingredient of (ingredientRows as any[]) || []) {
        if (ingredient?.id && ingredient?.custo_unitario !== null && ingredient?.custo_unitario !== undefined) {
          ingredientCost.set(String(ingredient.id), Number(ingredient.custo_unitario));
        }
      }

      const directCostByProduct = new Map<string, { cost: number; soldByWeight: boolean }>();
      for (const product of productRows || []) {
        const rawCost = product?.cost_price;
        const cost = rawCost === null || rawCost === undefined ? null : Number(rawCost);
        if (product?.id && cost !== null && Number.isFinite(cost) && cost >= 0) {
          directCostByProduct.set(String(product.id), {
            cost,
            soldByWeight: Boolean(product.sold_by_weight),
          });
        }
      }

      const recipesByProduct = new Map<string, Array<{ ingredientId: string; quantity: number }>>();
      for (const recipe of (recipeRows as any[]) || []) {
        const productId = recipe?.product_id || recipe?.produto_id;
        const ingredientId = recipe?.ingrediente_id || recipe?.ingredient_id;
        if (!productId || !ingredientId) continue;
        const list = recipesByProduct.get(String(productId)) || [];
        list.push({ ingredientId: String(ingredientId), quantity: Math.max(0, Number(recipe?.quantidade || 0)) });
        recipesByProduct.set(String(productId), list);
      }

      const nextCmv: Record<string, { cmv: number; complete: boolean }> = {};
      for (const order of (orderRows as any[]) || []) {
        const items = Array.isArray(order?.items) ? order.items : [];
        let cmv = 0;
        let complete = items.length > 0;

        for (const item of items) {
          const productId = item?.product_id || item?.product?.id || item?.id;
          const quantity = Math.max(0, Number(item?.quantity || 1));
          if (!productId || quantity <= 0) {
            complete = false;
            continue;
          }

          const productKey = String(productId);
          const recipes = recipesByProduct.get(productKey);
          let recipeCost = 0;
          let recipeComplete = Boolean(recipes?.length);

          if (recipes?.length) {
            for (const recipe of recipes) {
              const unitCost = ingredientCost.get(recipe.ingredientId);
              if (unitCost === undefined) {
                recipeComplete = false;
                break;
              }
              recipeCost += recipe.quantity * unitCost;
            }
          }

          if (recipeComplete) {
            cmv += recipeCost * quantity;
            continue;
          }

          const directCost = directCostByProduct.get(productKey);
          if (directCost) {
            const weightKg = Math.max(0, Number(item?.weight_kg ?? item?.weightKg ?? 0));
            const costUnits = directCost.soldByWeight && weightKg > 0 ? weightKg : quantity;
            cmv += directCost.cost * costUnits;
            continue;
          }

          complete = false;
        }

        nextCmv[String(order.id)] = { cmv, complete };
      }
      setCmvByOrder(nextCmv);
    }

    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [organizationId, start, end]);

  const paymentOptions = useMemo(() => {
    return Array.from(new Set(rows.map(r => normalizePaymentMethod(r.payment_method))))
      .sort((a, b) => (PAY_LABEL[a] || a).localeCompare(PAY_LABEL[b] || b, 'pt-BR'));
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (paymentFilter === 'all') return rows;
    return rows.filter(r => normalizePaymentMethod(r.payment_method) === paymentFilter);
  }, [rows, paymentFilter]);

  const totals = useMemo(() => {
    const t = { bruto: 0, gateway: 0, vision: 0, liquido: 0 };
    for (const r of filteredRows) {
      t.bruto += Number(r.valor_bruto || 0);
      t.gateway += Number(r.taxa_gateway_valor || 0);
      t.vision += Number(r.taxa_vision_valor || 0);
      t.liquido += Number(r.valor_liquido_final || 0);
    }
    return t;
  }, [filteredRows]);

  const cmvSummary = useMemo(() => {
    let cmv = 0;
    let completeOrders = 0;
    for (const r of filteredRows) {
      const info = cmvByOrder[r.order_id];
      if (info?.complete) completeOrders++;
      cmv += Number(info?.cmv || 0);
    }
    const complete = filteredRows.length > 0 && completeOrders === filteredRows.length;
    const coverage = filteredRows.length ? (completeOrders / filteredRows.length) * 100 : 100;
    const lucro = complete ? totals.liquido - cmv : null;
    const margem = lucro !== null && totals.bruto > 0 ? (lucro / totals.bruto) * 100 : null;
    return { cmv, complete, coverage, lucro, margem };
  }, [filteredRows, cmvByOrder, totals.liquido, totals.bruto]);

  const byMethod = useMemo(() => {
    const m = new Map<string, { count: number; bruto: number; gateway: number; vision: number; liquido: number }>();
    for (const r of filteredRows) {
      const k = normalizePaymentMethod(r.payment_method);
      const cur = m.get(k) || { count: 0, bruto: 0, gateway: 0, vision: 0, liquido: 0 };
      cur.count++;
      cur.bruto += Number(r.valor_bruto || 0);
      cur.gateway += Number(r.taxa_gateway_valor || 0);
      cur.vision += Number(r.taxa_vision_valor || 0);
      cur.liquido += Number(r.valor_liquido_final || 0);
      m.set(k, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].bruto - a[1].bruto);
  }, [filteredRows]);

  const exportCsv = () => {
    if (!filteredRows.length) { toast.info('Nada para exportar'); return; }
    const head = ['Pedido', 'Data', 'Cliente', 'Forma de pagamento', 'Valor bruto', 'Taxa gateway (não integrada)', 'Taxa Vision', 'Líquido estimado', 'CMV estimado', 'Lucro estimado'];
    const lines = [head.join(';')];
    for (const r of filteredRows) {
      lines.push([
        r.order_number,
        new Date(r.created_at).toLocaleString('pt-BR'),
        (r.customer_name || '').replace(/;/g, ','),
        PAY_LABEL[normalizePaymentMethod(r.payment_method)] || r.payment_method || '',
        r.valor_bruto.toFixed(2).replace('.', ','),
        r.taxa_gateway_valor.toFixed(2).replace('.', ','),
        r.taxa_vision_valor.toFixed(2).replace('.', ','),
        r.valor_liquido_final.toFixed(2).replace('.', ','),
        cmvByOrder[r.order_id]?.complete ? Number(cmvByOrder[r.order_id].cmv || 0).toFixed(2).replace('.', ',') : '',
        cmvByOrder[r.order_id]?.complete ? (Number(r.valor_liquido_final || 0) - Number(cmvByOrder[r.order_id].cmv || 0)).toFixed(2).replace('.', ',') : '',
      ].join(';'));
    }
    const csv = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `financeiro_${start}_a_${end}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <div className="bg-card rounded-2xl p-6 border border-border">
          <div className="flex items-center gap-3 mb-1">
            <Wallet className="w-6 h-6 text-primary" />
            <h2 className="text-xl font-bold">Financeiro & Repasse</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Veja o <strong>valor bruto</strong> e o líquido estimado após a taxa Vision configurada. A taxa real do gateway ainda não é liquidada automaticamente pelo sistema.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground block">Início</label>
              <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)}
                className="px-3 py-2 rounded-lg bg-background border border-input text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block">Fim</label>
              <input type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)}
                className="px-3 py-2 rounded-lg bg-background border border-input text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block">Pagamento</label>
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="px-3 py-2 rounded-lg bg-background border border-input text-sm min-w-[150px]"
              >
                <option value="all">Todos</option>
                {paymentOptions.map(method => (
                  <option key={method} value={method}>{PAY_LABEL[method] || method}</option>
                ))}
              </select>
            </div>
            <button onClick={exportCsv}
              className="touch-btn px-4 py-2 rounded-lg bg-muted hover:bg-muted/70 inline-flex items-center gap-2 text-sm">
              <Download className="w-4 h-4" /> Exportar CSV
            </button>
            <div className="ml-auto text-xs text-muted-foreground">
              Taxa Vision configurada: <strong>{taxaVision.toFixed(2)}%</strong>
            </div>
          </div>
        </div>

        {/* Cards de resumo */}
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <SummaryCard label="Total bruto" value={brl(totals.bruto)} icon={<DollarSign className="w-5 h-5" />} />
          <SummaryCard label="Taxa gateway" value={brl(totals.gateway)} variant="warn" />
          <SummaryCard label="Taxa Vision" value={brl(totals.vision)} variant="warn" />
          <SummaryCard label="Líquido estimado" value={brl(totals.liquido)} variant="good"
            icon={<TrendingUp className="w-5 h-5" />} />
          <SummaryCard
            label="CMV estimado"
            value={cmvSummary.complete ? brl(cmvSummary.cmv) : 'Incompleto'}
            variant={cmvSummary.complete ? 'default' : 'warn'}
          />
          <SummaryCard
            label="Lucro estimado"
            value={cmvSummary.lucro !== null ? brl(cmvSummary.lucro) : '—'}
            variant={cmvSummary.lucro !== null ? 'good' : 'warn'}
          />
        </div>

        <div className="bg-card rounded-2xl p-5 border border-border">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold">Resultado — DRE simplificada</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Usa a ficha técnica completa como prioridade e, quando ela não estiver disponível, usa o custo direto cadastrado no produto. Não inclui despesas fixas, impostos ou pró-labore.
              </p>
            </div>
            {cmvSummary.margem !== null && (
              <span className="text-sm font-bold text-primary">Margem estimada: {cmvSummary.margem.toFixed(1)}%</span>
            )}
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4"><span>Receita bruta</span><strong>{brl(totals.bruto)}</strong></div>
            <div className="flex justify-between gap-4 text-muted-foreground"><span>− Taxa gateway estimada</span><strong>{brl(totals.gateway)}</strong></div>
            <div className="flex justify-between gap-4 text-muted-foreground"><span>− Taxa Vision</span><strong>{brl(totals.vision)}</strong></div>
            <div className="flex justify-between gap-4 border-t border-border pt-2"><span>= Líquido estimado</span><strong>{brl(totals.liquido)}</strong></div>
            <div className="flex justify-between gap-4"><span>− CMV</span><strong>{cmvSummary.complete ? brl(cmvSummary.cmv) : 'cadastro incompleto'}</strong></div>
            <div className="flex justify-between gap-4 border-t border-border pt-2 text-base">
              <span>= Lucro estimado</span>
              <strong className="text-primary">{cmvSummary.lucro !== null ? brl(cmvSummary.lucro) : '—'}</strong>
            </div>
          </div>
          {!cmvSummary.complete && filteredRows.length > 0 && (
            <p className="mt-3 text-xs text-amber-400">
              CMV completo em {cmvSummary.coverage.toFixed(0)}% dos pedidos filtrados. Cadastre a ficha técnica/custos dos ingredientes ou o custo direto do produto para liberar o lucro.
            </p>
          )}
        </div>

        {/* Por método */}
        <div className="bg-card rounded-2xl p-6 border border-border">
          <h3 className="font-semibold mb-3">Consolidado por forma de pagamento</h3>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : byMethod.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2">Método</th>
                    <th className="py-2 text-right">Pedidos</th>
                    <th className="py-2 text-right">Bruto</th>
                    <th className="py-2 text-right">Líquido estimado</th>
                    <th className="py-2 text-right">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {byMethod.map(([k, v]) => (
                    <tr key={k} className="border-b border-border/40">
                      <td className="py-2 font-medium">{PAY_LABEL[k] || k}</td>
                      <td className="py-2 text-right">{v.count}</td>
                      <td className="py-2 text-right">{brl(v.bruto)}</td>
                      <td className="py-2 text-right font-bold text-primary">{brl(v.liquido)}</td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setCalcDetail({
                            method: PAY_LABEL[k] || k,
                            bruto: v.bruto,
                            vision: v.vision,
                            liquido: v.liquido,
                          })}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Info className="w-4 h-4" /> ver cálculo
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detalhe por pedido */}
        <div className="bg-card rounded-2xl p-6 border border-border">
          <h3 className="font-semibold mb-3">Pedidos do período ({filteredRows.length})</h3>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2">Pedido</th>
                    <th className="py-2">Data</th>
                    <th className="py-2">Pagamento</th>
                    <th className="py-2 text-right">Bruto</th>
                    <th className="py-2 text-right">Taxas</th>
                    <th className="py-2 text-right">Líquido estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.order_id} className="border-b border-border/40">
                      <td className="py-2 font-mono">#{r.order_number}</td>
                      <td className="py-2 text-muted-foreground">{new Date(r.created_at).toLocaleString('pt-BR')}</td>
                      <td className="py-2">{PAY_LABEL[normalizePaymentMethod(r.payment_method)] || r.payment_method}</td>
                      <td className="py-2 text-right">{brl(r.valor_bruto)}</td>
                      <td className="py-2 text-right text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="underline decoration-dotted cursor-help">
                              −{brl(r.taxa_gateway_valor + r.taxa_vision_valor)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <div>Gateway: não integrado</div>
                              <div>Vision: {brl(r.taxa_vision_valor)}</div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="py-2 text-right font-bold text-primary">{brl(r.valor_liquido_final)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Dialog
          open={Boolean(calcDetail)}
          onOpenChange={(open) => {
            if (!open) setCalcDetail(null);
          }}
        >
          <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle>Cálculo do líquido estimado</DialogTitle>
            </DialogHeader>
            {calcDetail && (
              <div className="space-y-3 text-sm">
                <div className="text-muted-foreground">
                  Forma de pagamento: <strong className="text-foreground">{calcDetail.method}</strong>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <span>Valor bruto</span>
                    <strong>{brl(calcDetail.bruto)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-muted-foreground">
                    <span>− Taxa gateway</span>
                    <strong>não integrada</strong>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>− Taxa Vision</span>
                    <strong>{brl(calcDetail.vision)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-border pt-2 text-base">
                    <span>= Líquido estimado</span>
                    <strong className="text-primary">{brl(calcDetail.liquido)}</strong>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};

function SummaryCard({
  label, value, icon, variant = 'default',
}: { label: string; value: string; icon?: React.ReactNode; variant?: 'default' | 'good' | 'warn' }) {
  const styles =
    variant === 'good' ? 'border-primary/40 bg-primary/5'
    : variant === 'warn' ? 'border-amber-500/30 bg-amber-500/5'
    : 'border-border bg-card';
  return (
    <div className={`rounded-2xl p-4 border ${styles}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>{icon}
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

export default FinanceiroPanel;
