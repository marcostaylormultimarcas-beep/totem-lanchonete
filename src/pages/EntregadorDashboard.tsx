import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, LogOut, CheckCircle2, MapPin, Phone, Package, RefreshCw, KeyRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getEntregadorSession, clearEntregadorSession } from './EntregadorLogin';
import { formatCurrency } from '@/data/store';

interface DeliveryOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string | null;
  delivery_reference: string | null;
  delivery_recipient: string | null;
  items: any[];
  total: number;
  status: string;
  created_at: string;
  delivery_code: string;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  preparing: { label: '👨‍🍳 Preparando', cls: 'bg-primary/15 text-primary border-primary/30' },
  ready: { label: '✅ Pronto p/ retirar', cls: 'bg-success/15 text-success border-success/30 animate-pulse' },
  out_for_delivery: { label: '🛵 A caminho', cls: 'bg-blue-400/15 text-blue-400 border-blue-400/30' },
  delivered: { label: '✓ Entregue', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

const EntregadorDashboard = () => {
  const navigate = useNavigate();
  const session = getEntregadorSession();
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const knownReadyIds = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const unlocked = useRef(false);

  useEffect(() => {
    if (!session) navigate('/entregador/login');
  }, [session, navigate]);

  const playAlert = useCallback(() => {
    if (!unlocked.current) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      [0, 0.18, 0.36].forEach(delay => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + delay + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.15);
        o.start(ctx.currentTime + delay);
        o.stop(ctx.currentTime + delay + 0.16);
      });
    } catch {}
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!session) return;
    const { data, error } = await supabase.rpc('entregador_orders' as any, {
      _entregador_id: session.id,
      _password: session.password,
    });
    const res: any = data;
    if (error || !res?.ok) {
      if (res?.reason === 'invalid_credentials') {
        clearEntregadorSession();
        navigate('/entregador/login');
      }
      setLoading(false);
      return;
    }
    const list: DeliveryOrder[] = res.orders || [];
    // detect new ready/out_for_delivery orders
    const currentReady = list.filter(o => o.status === 'preparing' || o.status === 'out_for_delivery' || o.status === 'ready');
    const newOnes = currentReady.filter(o => !knownReadyIds.current.has(o.id));
    if (newOnes.length > 0 && knownReadyIds.current.size > 0) {
      playAlert();
      toast.success(`🛵 Novo pedido para entrega: #${newOnes[0].order_number}`, { duration: 6000 });
    }
    currentReady.forEach(o => knownReadyIds.current.add(o.id));
    setOrders(list);
    setLoading(false);
  }, [session, navigate, playAlert]);

  useEffect(() => {
    fetchOrders();
    const i = setInterval(fetchOrders, 7000);
    return () => clearInterval(i);
  }, [fetchOrders]);

  const handleUnlockSound = async () => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      await audioCtxRef.current.resume();
      unlocked.current = true;
      toast.success('Alertas sonoros ativados.');
    } catch { toast.error('Não foi possível ativar o som.'); }
  };

  const handleConfirm = async (orderId: string) => {
    if (!session) return;
    const code = (codeInputs[orderId] || '').trim();
    if (code.length !== 4) {
      toast.error('Digite o código de 4 dígitos.');
      return;
    }
    setConfirming(orderId);
    const { data, error } = await supabase.rpc('confirm_delivery_with_code' as any, {
      _entregador_id: session.id,
      _password: session.password,
      _order_id: orderId,
      _code: code,
    });
    setConfirming(null);
    const res: any = data;
    if (error || !res?.ok) {
      const msg: Record<string, string> = {
        invalid_credentials: 'Sessão inválida. Faça login novamente.',
        not_found: 'Pedido não encontrado.',
        order_not_found: 'Pedido não encontrado.',
        forbidden: 'Pedido não pertence à sua loja.',
        not_assigned: 'Este pedido não está atribuído a você.',
        already_delivered: 'Pedido já foi entregue.',
        cancelled: 'Pedido cancelado.',
        invalid_code: '❌ Código incorreto! Confirme com o cliente.',
      };
      toast.error(msg[res?.reason] || 'Falha ao confirmar entrega.');
      return;
    }
    toast.success('✅ Entrega confirmada!');
    setCodeInputs(p => ({ ...p, [orderId]: '' }));
    fetchOrders();
  };

  const handleLogout = () => {
    clearEntregadorSession();
    navigate('/entregador/login');
  };

  if (!session) return null;

  const pendentes = orders.filter(o => o.status !== 'delivered');
  const entregues = orders.filter(o => o.status === 'delivered');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 bg-slate-900/90 backdrop-blur border-b border-orange-600/30 px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center">
          <Truck className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-400">{session.org_name}</p>
          <p className="font-bold truncate">{session.name}</p>
        </div>
        <button onClick={fetchOrders} className="p-2 text-slate-400 hover:text-orange-500" title="Atualizar">
          <RefreshCw className="w-5 h-5" />
        </button>
        <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-destructive" title="Sair">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {!unlocked.current && (
          <button
            onClick={handleUnlockSound}
            className="w-full bg-orange-600/15 border border-orange-600/40 text-orange-400 rounded-xl px-3 py-2 text-sm font-semibold animate-pulse"
          >
            🔔 Toque aqui para ativar os alertas sonoros
          </button>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-orange-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : pendentes.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <Package className="w-14 h-14 mx-auto mb-3 opacity-40" />
            <p>Nenhum pedido atribuído no momento.</p>
            <p className="text-xs mt-1">Aguarde — você será notificado quando chegar um novo.</p>
          </div>
        ) : (
          pendentes.map(o => {
            const st = STATUS_LABEL[o.status] || STATUS_LABEL.preparing;
            return (
              <div key={o.id} className="bg-slate-900 border border-orange-600/30 rounded-2xl p-4 space-y-3 shadow-[0_0_20px_-10px_rgba(234,88,12,0.5)]">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-orange-500 font-black text-lg">#{o.order_number}</span>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${st.cls}`}>{st.label}</span>
                  </div>
                  <span className="text-orange-500 font-black">{formatCurrency(o.total)}</span>
                </div>

                <div className="text-sm space-y-1.5">
                  <p className="flex items-center gap-2"><Package className="w-3.5 h-3.5 text-slate-500" /> <span className="font-semibold">{o.customer_name}</span></p>
                  {o.customer_phone && (
                    <a href={`tel:${o.customer_phone.replace(/\D/g,'')}`} className="flex items-center gap-2 text-blue-400 hover:underline">
                      <Phone className="w-3.5 h-3.5" /> {o.customer_phone}
                    </a>
                  )}
                  {o.delivery_address && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.delivery_address)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-start gap-2 text-blue-400 hover:underline"
                    >
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{o.delivery_address}</span>
                    </a>
                  )}
                  {o.delivery_reference && <p className="text-xs text-slate-400 pl-5">🧭 {o.delivery_reference}</p>}
                  {o.delivery_recipient && <p className="text-xs text-slate-400 pl-5">👥 Recebe: {o.delivery_recipient}</p>}
                </div>

                {Array.isArray(o.items) && o.items.length > 0 && (
                  <div className="text-xs space-y-0.5 bg-slate-800/60 rounded-lg p-2 text-slate-300">
                    {o.items.map((it: any, i: number) => (
                      <p key={i}>{it.quantity}x {it.name}</p>
                    ))}
                  </div>
                )}

                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <p className="text-xs text-slate-400 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-orange-500" />
                    Peça o <span className="font-bold text-orange-500">código de 4 dígitos</span> ao cliente para finalizar.
                  </p>
                  <div className="flex gap-2">
                    <input
                      inputMode="numeric"
                      pattern="\d{4}"
                      maxLength={4}
                      placeholder="0000"
                      value={codeInputs[o.id] || ''}
                      onChange={e => setCodeInputs(p => ({ ...p, [o.id]: e.target.value.replace(/\D/g, '').slice(0,4) }))}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-center text-2xl font-black tracking-[0.4em] text-orange-500 focus:border-orange-600 outline-none"
                    />
                    <button
                      onClick={() => handleConfirm(o.id)}
                      disabled={confirming === o.id || (codeInputs[o.id] || '').length !== 4}
                      className="bg-success hover:bg-success/90 text-success-foreground font-bold px-4 rounded-xl flex items-center gap-2 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                      {confirming === o.id ? '...' : 'OK'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {entregues.length > 0 && (
          <div className="pt-6">
            <h2 className="text-sm font-bold text-slate-400 mb-2">Entregues recentemente</h2>
            <div className="space-y-2">
              {entregues.slice(0, 10).map(o => (
                <div key={o.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 text-sm flex items-center justify-between">
                  <div>
                    <p className="font-semibold">#{o.order_number} — {o.customer_name}</p>
                    <p className="text-xs text-slate-500">{new Date(o.created_at).toLocaleString('pt-BR')}</p>
                  </div>
                  <span className="text-emerald-400 text-xs font-bold">✓ Entregue</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default EntregadorDashboard;
