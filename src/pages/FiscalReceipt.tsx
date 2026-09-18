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
}

const FiscalReceipt = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [store, setStore] = useState<StoreRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      setReason('not_found');
      return;
    }

    let active = true;
    (async () => {
      const { data, error } = await supabase.rpc('visionfood_order_receipt' as any, {
        _order_id: orderId,
      });
      if (!active) return;

      const result: any = data;
      if (error) {
        console.error('visionfood_order_receipt', error);
        setReason('error');
      } else if (!result?.ok) {
        setReason(result?.reason || 'not_found');
      } else {
        setOrder(result.order as OrderRow);
        setStore(result.store as StoreRow);
        setReason('');
      }
      setLoading(false);
    })();

    return () => { active = false; };
  }, [orderId]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Carregando comprovante...</div>;
  }

  if (!order) {
    const unauthenticated = reason === 'unauthenticated';
    const forbidden = reason === 'forbidden';
    return (
      <div className="min-h-screen flex flex-col gap-4 items-center justify-center bg-background text-foreground p-6 text-center">
        <p className="font-semibold">
          {unauthenticated
            ? 'Entre na sua conta para acessar este comprovante.'
            : forbidden
              ? 'Você não tem permissão para acessar este comprovante.'
              : 'Comprovante não encontrado.'}
        </p>
        {unauthenticated && orderId && (
          <a
            href={`/auth?returnTo=${encodeURIComponent(`/fiscal/${orderId}`)}`}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold"
          >
            Entrar
          </a>
        )}
      </div>
    );
  }

  const dt = new Date(order.created_at);
  const dtStr = dt.toLocaleString('pt-BR');
  const cpf = order.customer_cpf || '';
  const payLabel = ({ pix: 'PIX', cash: 'Dinheiro', terminal: 'Cartão (Maquininha)', online: 'Cartão Online' } as Record<string, string>)[order.payment_method] || order.payment_method || '—';
  const receiptCode = `PED-${order.id.replace(/-/g, '').slice(0, 16).toUpperCase()}`;

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
        </div>
        <div className="text-center py-2 border-b border-dashed border-black/40">
          <p className="font-bold">COMPROVANTE DO PEDIDO</p>
          <p className="text-[10px]">Documento não fiscal — uso interno</p>
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
          <p>Código interno: {receiptCode}</p>
          <p>Este comprovante não substitui documento fiscal autorizado.</p>
        </div>
      </div>
    </div>
  );
};

export default FiscalReceipt;
