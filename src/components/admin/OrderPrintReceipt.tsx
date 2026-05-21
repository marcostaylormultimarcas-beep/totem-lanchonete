import { createPortal } from 'react-dom';
import { formatCurrency } from '@/data/store';

interface Props {
  order: any | null;
  storeName: string;
  formatClass?: string;
}

const OrderPrintReceipt = ({ order, storeName, formatClass = 'print-cupom' }: Props) => {

  if (!order || typeof document === 'undefined') return null;

  const items: any[] = Array.isArray(order.items) ? order.items : [];
  const subtotal = items.reduce((s, i) => s + Number(i.total || 0), 0);
  const total = Number(order.total || 0);
  const discount = Math.max(0, subtotal - total);
  const created = new Date(order.created_at);

  const content = (
    <div id="print-receipt-area" className="print-receipt">
      <div className="pr-header">
        <h1>{storeName || 'Pedido'}</h1>
        <p>
          {created.toLocaleDateString('pt-BR')} {created.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="pr-order-num">PEDIDO #{order.order_number}</p>
      </div>

      <div className="pr-divider" />

      <div className="pr-section">
        <p><strong>Cliente:</strong> {order.customer_name}</p>
        {order.customer_phone && <p><strong>Telefone:</strong> {order.customer_phone}</p>}
        <p>
          <strong>Tipo:</strong>{' '}
          {order.order_type === 'delivery' ? 'DELIVERY' : order.order_type === 'retirada' ? 'RETIRADA' : 'COMER NO LOCAL'}
        </p>
        {order.order_type === 'delivery' && (
          <div className="pr-delivery">
            {order.delivery_address && <p><strong>Endereço:</strong> {order.delivery_address}</p>}
            {order.delivery_reference && <p><strong>Referência:</strong> {order.delivery_reference}</p>}
            {order.delivery_recipient && <p><strong>Recebe:</strong> {order.delivery_recipient}</p>}
          </div>
        )}
      </div>

      <div className="pr-divider" />

      <div className="pr-section">
        <p className="pr-section-title">ITENS</p>
        {items.map((item, i) => {
          const removed: string[] = item.removedIngredients || [];
          const extras: string[] = item.extras || [];
          const obs = [
            removed.length ? `Sem: ${removed.join(', ')}` : '',
            extras.length ? `Add: ${extras.join(', ')}` : '',
            item.notes || item.observation || '',
          ].filter(Boolean).join(' | ');
          return (
            <div key={i} className="pr-item">
              <div className="pr-item-row">
                <span>{item.quantity}x {item.name}</span>
                <span>{formatCurrency(item.total)}</span>
              </div>
              {obs && <p className="pr-obs">Obs: {obs}</p>}
            </div>
          );
        })}
      </div>

      <div className="pr-divider" />

      <div className="pr-section pr-totals">
        <div className="pr-item-row"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
        {discount > 0 && (
          <div className="pr-item-row"><span>Desconto</span><span>- {formatCurrency(discount)}</span></div>
        )}
        <div className="pr-item-row pr-total"><span>TOTAL</span><span>{formatCurrency(total)}</span></div>
        {order.payment_method && (
          <p className="pr-payment"><strong>Pagamento:</strong> {order.payment_method}</p>
        )}
      </div>

      <div className="pr-divider" />
      <p className="pr-footer">Obrigado pela preferência!</p>
    </div>
  );

  return createPortal(content, document.body);
};

export default OrderPrintReceipt;
