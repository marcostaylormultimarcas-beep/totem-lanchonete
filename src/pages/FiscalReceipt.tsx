import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';
import { Printer, Download } from 'lucide-react';

interface OrderRow {
  id: string;
  order_number: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  customer_cpf: string;
  total: number;
  items: any[];
  payment_method: string;
  organization_id: string;
}

interface StoreRow {
  store_name: string;
  fiscal_cnpj: string;
  fiscal_razao: string;
  fiscal_ie: string;
  fiscal_regime: string;
}

const FiscalReceipt = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [store, setStore] = useState<StoreRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    (async () => {
      const { data: o } = await supabase
        .from('orders')
        .select('id, order_number, created_at, customer_name, customer_phone, customer_cpf, total, items, payment_method, organization_id')
        .eq('id', orderId)
        .maybeSingle();
      if (o) {
        setOrder(o as unknown as OrderRow);
        const { data: s } = await supabase
          .from('settings')
          .select('store_name, fiscal_cnpj, fiscal_razao, fiscal_ie, fiscal_regime')
          .eq('organization_id', (o as any).organization_id)
          .maybeSingle();
        if (s) setStore(s as unknown as StoreRow);
      }
      setLoading(false);
    })();
  }, [orderId]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Carregando nota fiscal...</div>;
  }
  if (!order) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Nota não encontrada.</div>;
  }

  const dt = new Date(order.created_at);
  const dtStr = dt.toLocaleString('pt-BR');
  const cpf = order.customer_cpf || '';
  const payLabel = ({ pix: 'PIX', cash: 'Dinheiro', terminal: 'Cartão (Maquininha)', online: 'Cartão Online' } as Record<string, string>)[order.payment_method] || order.payment_method || '—';
  const fiscalCode = `NFE-${order.id.replace(/-/g, '').slice(0, 16).toUpperCase()}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-6 px-4 print:bg-white print:text-black">
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="max-w-md mx-auto space-y-3 no-print">
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="flex-1 bg-orange-600 hover:bg-orange-500 text-white py-3 rounded-lg flex items-center justify-center gap-2 font-bold">
            <Printer className="w-5 h-5" /> Imprimir
          </button>
          <button onClick={() => window.print()} className="flex-1 bg-slate-800 border border-orange-600/40 text-orange-400 py-3 rounded-lg flex items-center justify-center gap-2 font-bold">
            <Download className="w-5 h-5" /> Salvar PDF
          </button>
        </div>
        <p className="text-[11px] text-slate-400 text-center">Use "Salvar como PDF" no diálogo de impressão para baixar.</p>
      </div>

      <div className="max-w-md mx-auto mt-4 bg-white text-black font-mono text-[12px] leading-tight p-4 rounded print:rounded-none print:max-w-full print:p-2 border border-orange-600/30 print:border-0">
        <div className="text-center space-y-0.5 border-b border-dashed border-black/40 pb-2">
          <p className="font-bold text-[14px]">{store?.store_name || 'LOJA'}</p>
          {store?.fiscal_razao && <p>{store.fiscal_razao}</p>}
          {store?.fiscal_cnpj && <p>CNPJ: {store.fiscal_cnpj}</p>}
          {store?.fiscal_ie && <p>IE: {store.fiscal_ie}</p>}
          {store?.fiscal_regime && <p className="uppercase">Regime: {store.fiscal_regime}</p>}
        </div>
        <div className="text-center py-2 border-b border-dashed border-black/40">
          <p className="font-bold">CUPOM FISCAL — DANFE SIMPLIFICADA</p>
          <p className="text-[10px]">Documento auxiliar não fiscal — uso interno</p>
        </div>
        <div className="py-2 border-b border-dashed border-black/40 space-y-0.5">
          <div className="flex justify-between"><span>Pedido:</span><span className="font-bold">#{order.order_number}</span></div>
          <div className="flex justify-between"><span>Data:</span><span>{dtStr}</span></div>
          <div className="flex justify-between"><span>Cliente:</span><span>{order.customer_name}</span></div>
          {cpf && <div className="flex justify-between"><span>CPF:</span><span>{cpf}</span></div>}
        </div>
        <div className="py-2 border-b border-dashed border-black/40">
          <p className="font-bold mb-1">ITENS</p>
          {(Array.isArray(order.items) ? order.items : []).map((it: any, i: number) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="flex-1">{it.quantity}x {it.name}</span>
              <span>{formatCurrency(Number(it.total || it.price * (it.quantity || 1) || 0))}</span>
            </div>
          ))}
        </div>
        <div className="py-2 border-b border-dashed border-black/40 space-y-0.5">
          <div className="flex justify-between"><span>Pagamento:</span><span>{payLabel}</span></div>
          <div className="flex justify-between text-[14px] font-bold"><span>TOTAL:</span><span>{formatCurrency(Number(order.total || 0))}</span></div>
        </div>
        <div className="text-center pt-2 space-y-0.5 text-[10px]">
          <p>Código: {fiscalCode}</p>
          <p>Consulte a autenticidade na loja emissora.</p>
        </div>
      </div>
    </div>
  );
};

export default FiscalReceipt;
