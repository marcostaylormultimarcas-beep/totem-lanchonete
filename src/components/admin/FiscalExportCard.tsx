import { useState } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const PAY_LABEL: Record<string, string> = {
  pix: 'PIX',
  cash: 'Dinheiro',
  terminal: 'Cartão (Maquininha)',
  online: 'Cartão Online',
};

function csvEscape(value: any): string {
  const s = value == null ? '' : String(value);
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const FiscalExportCard = ({ organizationId }: { organizationId: string | null }) => {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const [start, setStart] = useState(firstOfMonth);
  const [end, setEnd] = useState(today);
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    if (!organizationId) {
      toast.error('Loja não identificada.');
      return;
    }
    if (!start || !end) {
      toast.error('Selecione o período.');
      return;
    }
    setLoading(true);
    try {
      const startIso = new Date(`${start}T00:00:00`).toISOString();
      const endIso = new Date(`${end}T23:59:59.999`).toISOString();

      // RLS já isola por organização. Filtramos no SQL como camada extra.
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, created_at, total, payment_method, customer_cpf, customer_name, status')
        .eq('organization_id', organizationId)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: true });

      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) {
        toast.info('Nenhum pedido encontrado no período.');
        setLoading(false);
        return;
      }

      const header = ['ID do Pedido', 'Número', 'Data', 'Cliente', 'CPF', 'Forma de Pagamento', 'Status', 'Valor Total (R$)'];
      const lines = [header.map(csvEscape).join(';')];

      for (const r of rows as any[]) {
        const dt = new Date(r.created_at).toLocaleString('pt-BR');
        const total = Number(r.total || 0).toFixed(2).replace('.', ',');
        const pay = PAY_LABEL[r.payment_method] || r.payment_method || '';
        lines.push([
          r.id,
          r.order_number,
          dt,
          r.customer_name || '',
          r.customer_cpf || '',
          pay,
          r.status,
          total,
        ].map(csvEscape).join(';'));
      }

      const csv = '\uFEFF' + lines.join('\r\n'); // BOM para Excel reconhecer UTF-8
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fiscal_${start}_a_${end}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Exportado ${rows.length} pedido(s).`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Falha ao exportar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="kiosk-card p-4 space-y-3 border border-orange-600/30">
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 rounded-full bg-orange-600/20 text-orange-400 flex items-center justify-center">
          <FileSpreadsheet className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-sm">Exportar Lote Fiscal (Contabilidade)</h3>
          <p className="text-[11px] text-muted-foreground">Gera CSV com pedidos do período (ID, data, valor, pagamento e CPF).</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">Data início</label>
          <input
            type="date"
            value={start}
            max={end}
            onChange={e => setStart(e.target.value)}
            className="w-full px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-orange-600 text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">Data fim</label>
          <input
            type="date"
            value={end}
            min={start}
            max={today}
            onChange={e => setEnd(e.target.value)}
            className="w-full px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-orange-600 text-sm"
          />
        </div>
      </div>

      <button
        onClick={handleExport}
        disabled={loading || !organizationId}
        className="touch-btn w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white py-3 rounded-xl flex items-center justify-center gap-2 font-bold"
      >
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
        {loading ? 'Gerando...' : 'Exportar Lote Fiscal (CSV)'}
      </button>

      <p className="text-[10px] text-muted-foreground">
        O arquivo pode ser aberto no Excel, Google Sheets ou enviado direto ao contador.
      </p>
    </div>
  );
};

export default FiscalExportCard;
