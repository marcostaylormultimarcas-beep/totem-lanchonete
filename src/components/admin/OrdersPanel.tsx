import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';
import { Clock, UtensilsCrossed, Truck, CheckCircle2, XCircle, RefreshCw, Printer, Bell, BellOff, Filter, KeyRound, AlertTriangle, FileText, Receipt, X, BellRing } from 'lucide-react';
import { toast } from 'sonner';
import OrderPrintReceipt from './OrderPrintReceipt';
import FeatureGate from '@/components/FeatureGate';
import { useOrderAlertSound } from '@/hooks/useOrderAlertSound';

type PrintFormat = 'cupom' | 'a4';
const PRINT_PREF_KEY = 'print_format_pref';


interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  order_type: string;
  delivery_address: string | null;
  delivery_reference: string | null;
  delivery_recipient: string | null;
  items: any[];
  total: number;
  status: string;
  created_at: string;
  nfe_status?: string;
  nfe_numero?: string;
  nfe_url?: string;
  status_reembolso?: string;
  delivery_code?: string;
  entregador_id?: string | null;
}

interface Entregador {
  id: string;
  name: string;
  active: boolean;
}

const REFUND_LABEL: Record<string, { label: string; cls: string }> = {
  none: { label: '', cls: '' },
  auto_eligible: { label: '💸 Reembolso automático', cls: 'bg-success/15 text-success border-success/30' },
  manual_required: { label: '⚠️ Reembolso manual (aprovar)', cls: 'bg-accent/15 text-accent border-accent/30' },
  processing: { label: '⏳ Reembolso em processamento', cls: 'bg-blue-400/15 text-blue-400 border-blue-400/30' },
  refunded: { label: '✅ Reembolsado', cls: 'bg-success/15 text-success border-success/30' },
  failed: { label: '❌ Reembolso falhou', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '⏳ Pendente', color: 'text-accent', bg: 'bg-accent/20' },
  preparing: { label: '👨‍🍳 Preparando', color: 'text-primary', bg: 'bg-primary/20' },
  out_for_delivery: { label: '🛵 Saiu p/ Entrega', color: 'text-blue-400', bg: 'bg-blue-400/20' },
  delivered: { label: '✅ Entregue', color: 'text-success', bg: 'bg-success/20' },
  cancelled: { label: '❌ Cancelado', color: 'text-destructive', bg: 'bg-destructive/20' },
};

const OrdersPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>('cupom');
  const [pendingPrintOrder, setPendingPrintOrder] = useState<Order | null>(null);

  const [storeName, setStoreName] = useState<string>('');
  const [entregadores, setEntregadores] = useState<Entregador[]>([]);
  const [lowStockIds, setLowStockIds] = useState<Set<string>>(new Set());

  // Advanced filters
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  useEffect(() => {
    if (!organizationId) { setStoreName(''); setEntregadores([]); return; }
    supabase.from('settings').select('store_name').eq('organization_id', organizationId).maybeSingle()
      .then(({ data }) => setStoreName((data as any)?.store_name || ''));
    supabase.from('entregadores' as any).select('id,name,active').eq('organization_id', organizationId).eq('active', true)
      .then(({ data }) => setEntregadores(((data as any[]) || []) as Entregador[]));
    supabase.from('products').select('id').eq('organization_id', organizationId).eq('manage_stock', true)
      .lte('stock_quantity', 5)
      .then(({ data }) => setLowStockIds(new Set(((data as any[]) || []).map((p: any) => p.id))));
  }, [organizationId]);

  const openPrintDialog = (order: Order) => {
    setPendingPrintOrder(order);
  };

  const doPrint = (order: Order, format: PrintFormat) => {
    try { localStorage.setItem(PRINT_PREF_KEY, format); } catch {}
    setPrintFormat(format);
    setPrintOrder(order);
    setPendingPrintOrder(null);
    const cleanup = () => {
      setPrintOrder(null);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          // Garante classe no body antes da impressão
          document.body.classList.add(format === 'cupom' ? 'printing-cupom' : 'printing-a4');
          window.print();
          // Fallback se afterprint não disparar (alguns browsers)
          setTimeout(() => {
            document.body.classList.remove('printing-cupom', 'printing-a4');
            setPrintOrder(null);
          }, 800);
        }, 120);
      });
    });
  };

  // Restaura preferência ao montar
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PRINT_PREF_KEY) as PrintFormat | null;
      if (saved === 'cupom' || saved === 'a4') setPrintFormat(saved);
    } catch {}
  }, []);


  const fetchOrders = async () => {
    if (!organizationId) { setOrders([]); return; }
    let query = supabase.from('orders').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false });
    if (filter === 'active') {
      query = query.in('status', ['pending', 'preparing', 'out_for_delivery']);
    }
    if (dateFrom) query = query.gte('created_at', new Date(dateFrom).toISOString());
    if (dateTo) {
      const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
      query = query.lte('created_at', end.toISOString());
    }
    const { data } = await query.limit(200);
    if (data) setOrders(data as Order[]);
  };

  useEffect(() => {
    fetchOrders();
    if (!organizationId) return;

    const channel = supabase
      .channel('admin-orders-' + organizationId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `organization_id=eq.${organizationId}` }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [filter, organizationId, dateFrom, dateTo]);

  // Client-side product/low-stock filter
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const items = (o.items as any[]) || [];
      if (productQuery.trim()) {
        const q = productQuery.trim().toLowerCase();
        if (!items.some(it => (it.name || '').toLowerCase().includes(q))) return false;
      }
      if (onlyLowStock) {
        if (!items.some(it => {
          const pid = it.product_id || it.id;
          return pid && lowStockIds.has(pid);
        })) return false;
      }
      return true;
    });
  }, [orders, productQuery, onlyLowStock, lowStockIds]);

  const assignEntregador = async (orderId: string, entregadorId: string | null) => {
    const { toast } = await import('sonner');
    const { data, error } = await supabase.rpc('assign_entregador' as any, {
      _order_id: orderId,
      _entregador_id: entregadorId,
    });
    const res: any = data;
    if (error || !res?.ok) {
      toast.error('Falha ao atribuir entregador.');
      return;
    }
    toast.success(entregadorId ? 'Entregador atribuído.' : 'Atribuição removida.');
    fetchOrders();
  };

  const updateStatus = async (id: string, status: string, motivo?: string) => {
    const { toast } = await import('sonner');

    if (status === 'cancelled') {
      const { data, error } = await supabase.rpc('cancelar_pedido' as any, { _order_id: id, _motivo: motivo ?? null });
      const res: any = data;
      if (error) {
        console.error('cancelar_pedido', error);
        toast.error('Não foi possível cancelar o pedido.');
        return;
      }
      if (res?.ok) {
        if (res.already_cancelled) {
          toast.success('Pedido já estava cancelado.');
        } else {
          const ref = res.status_reembolso === 'auto_eligible'
            ? ' Reembolso automático elegível.'
            : res.status_reembolso === 'manual_required'
              ? ' Reembolso requer aprovação manual.'
              : '';
          toast.success('Pedido cancelado e estoque devolvido.' + ref);
        }
      } else {
        const msg: Record<string, string> = {
          forbidden: 'Sem permissão para cancelar este pedido.',
          admin_only: 'A partir do preparo, apenas o lojista pode cancelar.',
          reason_required: 'Informe um motivo (mín. 3 caracteres).',
          status_locked: 'Pedido não pode mais ser cancelado pelo cliente.',
          already_delivered: 'Pedido já entregue — não pode ser cancelado.',
          not_found: 'Pedido não encontrado.',
        };
        toast.error(msg[res?.reason] || 'Falha ao cancelar.');
      }
      return;
    }

    await supabase.from('orders').update({ status }).eq('id', id);
    if (status === 'delivered') {
      const order = orders.find(o => o.id === id);
      const { data, error } = await supabase.rpc('grant_loyalty_stamp' as any, { _order_id: id });
      const res: any = data;
      if (error) {
        console.error('grant_loyalty_stamp', error);
      } else if (res?.ok) {
        if (res.completed) {
          toast.success(`🎉 ${order?.customer_name || 'Cliente'} completou o cartão! Prêmio gerado (código ${res.codigo}).`);
        } else {
          toast.success(`+1 carimbo (${res.carimbos}/${res.meta}) para ${order?.customer_name || 'cliente'}.`);
        }
      } else if (res?.reason && !['below_minimum', 'no_phone', 'inactive', 'already_stamped'].includes(res.reason)) {
        console.warn('Carimbo não concedido:', res?.reason);
      }
    }
  };

  const callPassword = async (order: Order) => {
    if (!organizationId) return;
    const numero = String(order.order_number || '').trim();
    if (!numero) return;
    const { error } = await (supabase.from('senhas_chamadas' as any).insert({
      organization_id: organizationId,
      numero,
      tipo: 'normal',
    }) as any);
    if (error) {
      toast.error('Erro ao chamar senha');
      console.error(error);
    } else {
      toast.success(`🔔 Senha #${numero} chamada na TV`);
    }
  };

  const hasPending = orders.some(o => o.status === 'pending');
  const { needsUnlock, muted, setMuted, unlock } = useOrderAlertSound(hasPending);

  return (
    <div className="px-4 space-y-4">
      {needsUnlock && hasPending && (
        <button
          onClick={unlock}
          className="w-full bg-accent/15 border border-accent/40 text-accent rounded-lg px-3 py-2 text-sm font-semibold animate-pulse"
        >
          🔔 Clique em qualquer lugar da tela para ativar os alertas sonoros de novos pedidos
        </button>
      )}

      <div className="flex gap-2 items-center flex-wrap">
        <button
          onClick={() => setMuted(m => !m)}
          className={`touch-btn px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 border ${
            muted
              ? 'bg-muted text-muted-foreground border-border'
              : hasPending
                ? 'bg-accent/20 text-accent border-accent/40 animate-pulse'
                : 'bg-foreground/5 text-foreground border-border'
          }`}
          title={muted ? 'Reativar alertas' : 'Silenciar alertas'}
        >
          {muted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          <span className="hidden sm:inline">{muted ? 'Mutado' : 'Alertas'}</span>
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('active')}
            className={`touch-btn px-4 py-2 rounded-lg text-sm ${filter === 'active' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            Ativos
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`touch-btn px-4 py-2 rounded-lg text-sm ${filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            Todos
          </button>
        </div>
        <button
          onClick={() => setShowFilters(s => !s)}
          className={`touch-btn px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 border ${showFilters ? 'bg-primary/20 text-primary border-primary/30' : 'bg-foreground/5 text-foreground border-border'}`}
        >
          <Filter className="w-4 h-4" /> Filtros
        </button>
        <button onClick={fetchOrders} className="ml-auto p-2 text-muted-foreground hover:text-foreground">
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {showFilters && (
        <div className="kiosk-card p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border border-primary/30">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">De</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full bg-muted border border-border rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Até</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full bg-muted border border-border rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Produto contém</label>
            <input value={productQuery} onChange={e => setProductQuery(e.target.value)} placeholder="ex: x-burger" className="w-full bg-muted border border-border rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={onlyLowStock} onChange={e => setOnlyLowStock(e.target.checked)} />
              <AlertTriangle className="w-4 h-4 text-accent" /> Só com estoque baixo
            </label>
          </div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-between items-center">
            <p className="text-xs text-muted-foreground">{filteredOrders.length} de {orders.length} pedidos</p>
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setProductQuery(''); setOnlyLowStock(false); }}
              className="text-xs text-primary underline"
            >Limpar filtros</button>
          </div>
        </div>
      )}

      {filteredOrders.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Nenhum pedido encontrado</p>
        </div>
      )}

      {filteredOrders.map(order => {
        const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
        const isDelivery = order.order_type === 'delivery';
        const hasLowStockItem = ((order.items as any[]) || []).some(it => (it.product_id || it.id) && lowStockIds.has(it.product_id || it.id));
        return (
          <div key={order.id} className="kiosk-card p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-primary font-black text-lg">#{order.order_number}</span>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${cfg.bg} ${cfg.color}`}>
                  {cfg.label}
                </span>
                {hasLowStockItem && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-accent/15 text-accent border border-accent/30 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Estoque baixo
                  </span>
                )}
                {order.nfe_status && order.nfe_status !== 'none' && (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border flex items-center gap-1 ${
                    order.nfe_status === 'issued' ? 'bg-success/15 text-success border-success/30'
                    : order.nfe_status === 'pending' ? 'bg-accent/15 text-accent border-accent/30'
                    : 'bg-destructive/15 text-destructive border-destructive/30'
                  }`}>
                    📄 NFe {order.nfe_status === 'issued' ? `#${order.nfe_numero || '—'}` : order.nfe_status}
                  </span>
                )}
                {order.status === 'cancelled' && order.status_reembolso && order.status_reembolso !== 'none' && REFUND_LABEL[order.status_reembolso] && (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${REFUND_LABEL[order.status_reembolso].cls}`}>
                    {REFUND_LABEL[order.status_reembolso].label}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <div className="text-sm space-y-1">
              <p>👤 <span className="font-semibold">{order.customer_name}</span> — {order.customer_phone}</p>
              {!isDelivery ? (
                <p>📍 Comer no Local</p>
              ) : (
                <div className="bg-blue-400/10 border border-blue-400/30 rounded-lg p-2 space-y-1 mt-1">
                  <p className="text-blue-400 font-bold text-xs uppercase tracking-wide flex items-center gap-1">
                    <Truck className="w-3 h-3" /> Entrega
                  </p>
                  {order.delivery_address && <p>📌 <span className="font-semibold">Endereço:</span> {order.delivery_address}</p>}
                  {order.delivery_reference && <p>🧭 <span className="font-semibold">Referência:</span> {order.delivery_reference}</p>}
                  {order.delivery_recipient && <p>👥 <span className="font-semibold">Recebe:</span> {order.delivery_recipient}</p>}
                  {order.delivery_code && order.status !== 'delivered' && order.status !== 'cancelled' && (
                    <p className="flex items-center gap-1.5 text-orange-400 font-bold pt-1">
                      <KeyRound className="w-3.5 h-3.5" /> Código: <span className="text-lg tracking-[0.3em]">{order.delivery_code}</span>
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="text-xs space-y-0.5 bg-muted/50 rounded-lg p-2">
              {(order.items as any[]).map((item: any, i: number) => {
                if (item.sold_by_weight && item.weight_kg) {
                  const kg = Number(item.weight_kg).toFixed(3).replace('.', ',');
                  const pk = Number(item.price_per_kg || item.price || 0);
                  return (
                    <p key={i} className="text-amber-400">
                      ⚖️ {item.name} — {kg} kg × {formatCurrency(pk)}/kg = <span className="font-bold">{formatCurrency(item.total)}</span>
                    </p>
                  );
                }
                return <p key={i}>{item.quantity}x {item.name} — {formatCurrency(item.total)}</p>;
              })}
            </div>

            {isDelivery && order.status !== 'cancelled' && order.status !== 'delivered' && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">🛵 Entregador:</span>
                <select
                  value={order.entregador_id || ''}
                  onChange={e => assignEntregador(order.id, e.target.value || null)}
                  className="flex-1 bg-muted border border-border rounded-lg px-2 py-1.5 text-sm"
                >
                  <option value="">— Não atribuído —</option>
                  {entregadores.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
                {entregadores.length === 0 && (
                  <span className="text-[10px] text-muted-foreground">Cadastre na aba "Entregadores"</span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="font-black text-primary">{formatCurrency(order.total)}</span>
              <FeatureGate feature="print_receipt" label="Impressão" inline>
                <button
                  onClick={() => openPrintDialog(order)}
                  className="touch-btn py-2 px-3 rounded-lg text-sm bg-foreground/5 hover:bg-foreground/10 border border-border flex items-center gap-1.5 font-semibold"
                >
                  <Printer className="w-4 h-4" /> Imprimir
                </button>
              </FeatureGate>
            </div>


            {order.status !== 'delivered' && order.status !== 'cancelled' && (
              <div className="flex gap-2 flex-wrap">
                {order.status === 'pending' && (
                  <button
                    onClick={() => updateStatus(order.id, 'preparing')}
                    className="flex-1 touch-btn py-2 rounded-lg text-sm bg-primary/20 text-primary border border-primary/30 flex items-center justify-center gap-1"
                  >
                    <UtensilsCrossed className="w-4 h-4" /> Preparando
                  </button>
                )}
                {(order.status === 'pending' || order.status === 'preparing') && (
                  <button
                    onClick={() => updateStatus(order.id, 'out_for_delivery')}
                    className="flex-1 touch-btn py-2 rounded-lg text-sm bg-blue-400/20 text-blue-400 border border-blue-400/30 flex items-center justify-center gap-1"
                  >
                    <Truck className="w-4 h-4" /> Saiu p/ Entrega
                  </button>
                )}
                {order.status !== 'delivered' && (
                  <button
                    onClick={() => updateStatus(order.id, 'delivered')}
                    className="flex-1 touch-btn py-2 rounded-lg text-sm bg-success/20 text-success border border-success/30 flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Entregue
                  </button>
                )}
                <button
                  onClick={() => callPassword(order)}
                  className="touch-btn py-2 px-3 rounded-lg text-sm bg-gradient-to-r from-amber-500 to-orange-600 text-white border border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.4)] hover:brightness-110 flex items-center justify-center gap-1 font-bold"
                  title="Chamar / Rechamar senha na TV"
                >
                  <BellRing className="w-4 h-4" /> Chamar Senha
                </button>
                <button
                  onClick={() => {
                    const postPrep = order.status === 'preparing' || order.status === 'out_for_delivery';
                    if (postPrep) {
                      const motivo = prompt('Motivo do cancelamento (obrigatório a partir do preparo):');
                      if (!motivo || motivo.trim().length < 3) return;
                      updateStatus(order.id, 'cancelled', motivo.trim());
                    } else {
                      if (confirm('Cancelar este pedido? O estoque será devolvido.')) {
                        updateStatus(order.id, 'cancelled');
                      }
                    }
                  }}
                  className="touch-btn py-2 px-3 rounded-lg text-sm bg-destructive/20 text-destructive border border-destructive/30 flex items-center justify-center gap-1"
                  title="Cancelar pedido"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        );
      })}

      <OrderPrintReceipt order={printOrder} storeName={storeName} formatClass={printFormat === 'a4' ? 'print-a4' : 'print-cupom'} />

      {pendingPrintOrder && (
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPendingPrintOrder(null)}>
          <div className="kiosk-card w-full max-w-md p-5 border border-primary/40" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-black">Formato de Impressão</h3>
              <button onClick={() => setPendingPrintOrder(null)} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Pedido #{pendingPrintOrder.order_number} — escolha o formato.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => doPrint(pendingPrintOrder, 'cupom')}
                className={`p-4 rounded-xl border text-left transition flex flex-col gap-1.5 ${printFormat === 'cupom' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
              >
                <div className="flex items-center gap-2 font-bold"><Receipt className="w-5 h-5 text-primary" /> Térmica (58/80mm)</div>
                <p className="text-[11px] text-muted-foreground">Cupom estreito, sem margens, ideal para impressora térmica.</p>
                {printFormat === 'cupom' && <span className="text-[10px] text-primary font-bold">★ Preferida</span>}
              </button>
              <button
                onClick={() => doPrint(pendingPrintOrder, 'a4')}
                className={`p-4 rounded-xl border text-left transition flex flex-col gap-1.5 ${printFormat === 'a4' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
              >
                <div className="flex items-center gap-2 font-bold"><FileText className="w-5 h-5 text-primary" /> Folha A4</div>
                <p className="text-[11px] text-muted-foreground">Layout centralizado, fontes maiores, margens para papel comum.</p>
                {printFormat === 'a4' && <span className="text-[10px] text-primary font-bold">★ Preferida</span>}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 text-center">Sua escolha será lembrada para os próximos pedidos.</p>
          </div>
        </div>
      )}
    </div>

  );
};

export default OrdersPanel;
