import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, Download, Loader2, Info, TrendingUp, Wallet } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const startIso = new Date(`${start}T00:00:00`).toISOString();
    const endIso = new Date(`${end}T23:59:59.999`).toISOString();
    const { data, error } = await supabase
      .from('v_financeiro_detalhado' as any)
      .select('*')
      .eq('organization_id', organizationId)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as any) || []);
    const { data: s } = await supabase
      .from('settings').select('taxa_vision_percent').eq('organization_id', organizationId).maybeSingle();
    setTaxaVision(Number((s as any)?.taxa_vision_percent || 0));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [organizationId, start, end]);

  const totals = useMemo(() => {
    const t = { bruto: 0, gateway: 0, vision: 0, liquido: 0 };
    for (const r of rows) {
      t.bruto += Number(r.valor_bruto || 0);
      t.gateway += Number(r.taxa_gateway_valor || 0);
      t.vision += Number(r.taxa_vision_valor || 0);
      t.liquido += Number(r.valor_liquido_final || 0);
    }
    return t;
  }, [rows]);

  const byMethod = useMemo(() => {
    const m = new Map<string, { count: number; bruto: number; gateway: number; vision: number; liquido: number }>();
    for (const r of rows) {
      const k = r.payment_method || 'outro';
      const cur = m.get(k) || { count: 0, bruto: 0, gateway: 0, vision: 0, liquido: 0 };
      cur.count++;
      cur.bruto += Number(r.valor_bruto || 0);
      cur.gateway += Number(r.taxa_gateway_valor || 0);
      cur.vision += Number(r.taxa_vision_valor || 0);
      cur.liquido += Number(r.valor_liquido_final || 0);
      m.set(k, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].bruto - a[1].bruto);
  }, [rows]);

  const exportCsv = () => {
    if (!rows.length) { toast.info('Nada para exportar'); return; }
    const head = ['Pedido', 'Data', 'Cliente', 'Forma de pagamento', 'Valor bruto', 'Taxa gateway', 'Taxa Vision', 'Valor a receber'];
    const lines = [head.join(';')];
    for (const r of rows) {
      lines.push([
        r.order_number,
        new Date(r.created_at).toLocaleString('pt-BR'),
        (r.customer_name || '').replace(/;/g, ','),
        PAY_LABEL[r.payment_method] || r.payment_method || '',
        r.valor_bruto.toFixed(2).replace('.', ','),
        r.taxa_gateway_valor.toFixed(2).replace('.', ','),
        r.taxa_vision_valor.toFixed(2).replace('.', ','),
        r.valor_liquido_final.toFixed(2).replace('.', ','),
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
            Veja exatamente o <strong>valor a receber</strong> em cada pedido — já descontando taxas do gateway e da plataforma.
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard label="Total bruto" value={brl(totals.bruto)} icon={<DollarSign className="w-5 h-5" />} />
          <SummaryCard label="Taxa gateway" value={brl(totals.gateway)} variant="warn" />
          <SummaryCard label="Taxa Vision" value={brl(totals.vision)} variant="warn" />
          <SummaryCard label="Valor para receber" value={brl(totals.liquido)} variant="good"
            icon={<TrendingUp className="w-5 h-5" />} />
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
                    <th className="py-2 text-right">A receber</th>
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                              <Info className="w-4 h-4" /> ver cálculo
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <div className="text-xs space-y-0.5">
                              <div>Bruto: <strong>{brl(v.bruto)}</strong></div>
                              <div>− Taxa gateway: <strong>{brl(v.gateway)}</strong></div>
                              <div>− Taxa Vision: <strong>{brl(v.vision)}</strong></div>
                              <div className="pt-1 border-t border-border mt-1">
                                = A receber: <strong className="text-primary">{brl(v.liquido)}</strong>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
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
          <h3 className="font-semibold mb-3">Pedidos do período ({rows.length})</h3>
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
                    <th className="py-2 text-right">A receber</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.order_id} className="border-b border-border/40">
                      <td className="py-2 font-mono">#{r.order_number}</td>
                      <td className="py-2 text-muted-foreground">{new Date(r.created_at).toLocaleString('pt-BR')}</td>
                      <td className="py-2">{PAY_LABEL[r.payment_method] || r.payment_method}</td>
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
                              <div>Gateway: {brl(r.taxa_gateway_valor)}</div>
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
