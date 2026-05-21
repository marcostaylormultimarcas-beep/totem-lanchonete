import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, LogOut, CheckCircle2, MapPin, Phone, Package, RefreshCw, KeyRound, History, Clock } from 'lucide-react';
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
  const [claiming, setClaiming] = useState<string | null>(null);
  const [mode, setMode] = useState<'manual' | 'free'>('manual');
  const [available, setAvailable] = useState<DeliveryOrder[]>([]);
  const [tab, setTab] = useState<'pendentes' | 'disponiveis' | 'historico'>('pendentes');
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const unlocked = useRef(false);
  const [, forceRender] = useState(0);

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

  const fetchOrders = useCallback(async (silent = false) => {
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
    // Detecta pedidos NOVOS atribuídos (ainda não entregues) para alerta sonoro
    const ativos = list.filter(o => o.status !== 'delivered');
    const novos = ativos.filter(o => !knownIds.current.has(o.id));
    if (!silent && novos.length > 0 && knownIds.current.size > 0) {
      playAlert();
      toast.success(`🛵 Novo pedido atribuído: #${novos[0].order_number}`, { duration: 6000 });
      // Destaque visual (pulse) por 8s nos novos pedidos
      const newIds = new Set(novos.map(o => o.id));
      setHighlightIds(prev => {
        const next = new Set(prev);
        newIds.forEach(id => next.add(id));
        return next;
      });
      setTimeout(() => {
        setHighlightIds(prev => {
          const next = new Set(prev);
          newIds.forEach(id => next.delete(id));
          return next;
        });
      }, 8000);
    }
    ativos.forEach(o => knownIds.current.add(o.id));
    setOrders(list);
    setLoading(false);
  }, [session, navigate, playAlert]);

  const fetchAvailable = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase.rpc('entregador_available_orders' as any, {
      _entregador_id: session.id,
      _password: session.password,
    });
    const res: any = data;
    if (!res?.ok) return;
    setMode((res.mode === 'free' ? 'free' : 'manual'));
    setAvailable(res.orders || []);
  }, [session]);

  // Carga inicial + polling de segurança
  useEffect(() => {
    fetchOrders(true);
    fetchAvailable();
    const i = setInterval(() => { fetchOrders(false); fetchAvailable(); }, 15000);
    return () => clearInterval(i);
  }, [fetchOrders, fetchAvailable]);

  // Realtime: escuta mudanças na tabela orders da loja do entregador
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel(`entregador-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `organization_id=eq.${session.organization_id}`,
        },
        (payload: any) => {
          // Atualiza pedidos atribuídos a este entregador
          if (
            payload.new?.entregador_id === session.id ||
            payload.old?.entregador_id === session.id
          ) {
            fetchOrders(false);
          }
          // Em modo Disputa Livre: refresca lista de disponíveis em qualquer mudança da loja
          fetchAvailable();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, fetchOrders, fetchAvailable]);

  const handleClaim = async (orderId: string) => {
    if (!session) return;
    setClaiming(orderId);
    const { data, error } = await supabase.rpc('entregador_claim_order' as any, {
      _entregador_id: session.id,
      _password: session.password,
      _order_id: orderId,
    });
    setClaiming(null);
    const res: any = data;
    if (error || !res?.ok) {
      const msg: Record<string, string> = {
        invalid_credentials: 'Sessão inválida. Faça login novamente.',
        order_not_found: 'Pedido não encontrado.',
        forbidden: 'Pedido não pertence à sua loja.',
        mode_not_free: 'Modo de disputa livre não está ativo.',
        already_taken: 'Outro entregador foi mais rápido nesse pedido.',
      };
      toast.error(msg[res?.reason] || 'Não foi possível aceitar o pedido.');
      fetchAvailable();
      return;
    }
    toast.success('🛵 Pedido aceito! Vá até a loja para retirar.');
    setAvailable(prev => prev.filter(o => o.id !== orderId));
    fetchOrders(true);
    setTab('pendentes');
  };

  const handleUnlockSound = async () => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      await audioCtxRef.current.resume();
      unlocked.current = true;
      forceRender(x => x + 1);
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
    // Move imediatamente para o Histórico via update otimista
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'delivered' } : o));
    fetchOrders(true);
  };

  const handleLogout = () => {
    clearEntregadorSession();
    navigate('/entregador/login');
  };

  if (!session) return null;

  const pendentes = orders.filter(o => o.status !== 'delivered');
  const entregues = orders
    .filter(o => o.status === 'delivered')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

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
        <button onClick={() => fetchOrders(false)} className="p-2 text-slate-400 hover:text-orange-500" title="Atualizar">
          <RefreshCw className="w-5 h-5" />
        </button>
        <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-destructive" title="Sair">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Tabs */}
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <div className={`grid ${mode === 'free' ? 'grid-cols-3' : 'grid-cols-2'} bg-slate-900 border border-slate-800 rounded-xl p-1 gap-1`}>
          <button
            onClick={() => setTab('pendentes')}
            className={`py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
              tab === 'pendentes' ? 'bg-orange-600 text-white' : 'text-slate-400'
            }`}
          >
            <Clock className="w-4 h-4" /> Pendentes
            {pendentes.length > 0 && (
              <span className="bg-white/20 text-[10px] font-black px-1.5 py-0.5 rounded-full">{pendentes.length}</span>
            )}
          </button>
          {mode === 'free' && (
            <button
              onClick={() => setTab('disponiveis')}
              className={`py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                tab === 'disponiveis' ? 'bg-orange-600 text-white' : 'text-slate-400'
              }`}
            >
              ⚡ Disponíveis
              {available.length > 0 && (
                <span className="bg-yellow-400 text-black text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse">{available.length}</span>
              )}
            </button>
          )}
          <button
            onClick={() => setTab('historico')}
            className={`py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
              tab === 'historico' ? 'bg-orange-600 text-white' : 'text-slate-400'
            }`}
          >
            <History className="w-4 h-4" /> Histórico
            {entregues.length > 0 && (
              <span className="bg-white/20 text-[10px] font-black px-1.5 py-0.5 rounded-full">{entregues.length}</span>
            )}
          </button>
        </div>
        {mode === 'free' && (
          <p className="text-[11px] text-yellow-400/80 mt-2 text-center font-semibold">
            ⚡ Modo Disputa Livre — o primeiro a aceitar fica com o pedido!
          </p>
        )}
      </div>

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
        ) : tab === 'pendentes' ? (
          pendentes.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <Package className="w-14 h-14 mx-auto mb-3 opacity-40" />
              <p>Nenhum pedido atribuído no momento.</p>
              <p className="text-xs mt-1">Aguarde — você será notificado quando chegar um novo.</p>
            </div>
          ) : (
            pendentes.map(o => {
              const st = STATUS_LABEL[o.status] || STATUS_LABEL.preparing;
              return (
                <div
                  key={o.id}
                  className={`bg-slate-900 rounded-2xl p-4 space-y-3 transition-all ${
                    highlightIds.has(o.id)
                      ? 'border-2 border-orange-500 shadow-[0_0_30px_-5px_rgba(234,88,12,0.9)] animate-pulse ring-2 ring-orange-500/40'
                      : 'border border-orange-600/30 shadow-[0_0_20px_-10px_rgba(234,88,12,0.5)]'
                  }`}
                >
                  {highlightIds.has(o.id) && (
                    <div className="text-[10px] font-black uppercase tracking-wider bg-orange-500 text-white px-2 py-1 rounded-full inline-block">
                      🆕 Novo pedido atribuído
                    </div>
                  )}
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
          )
        ) : tab === 'disponiveis' ? (
          available.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <Package className="w-14 h-14 mx-auto mb-3 opacity-40" />
              <p>Nenhum pedido disponível para disputa.</p>
              <p className="text-xs mt-1">Aguarde — novos pedidos aparecerão aqui em tempo real.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {available.map(o => (
                <div key={o.id} className="bg-slate-900 border-2 border-yellow-500/40 rounded-2xl p-4 space-y-2 shadow-[0_0_25px_-10px_rgba(234,179,8,0.6)]">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-yellow-400 font-black text-lg">#{o.order_number}</span>
                    <span className="text-orange-500 font-black">{formatCurrency(o.total)}</span>
                  </div>
                  <p className="text-sm font-semibold">{o.customer_name}</p>
                  {o.delivery_address && (
                    <p className="text-xs text-slate-400 flex items-start gap-1">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {o.delivery_address}
                    </p>
                  )}
                  <button
                    onClick={() => handleClaim(o.id)}
                    disabled={claiming === o.id}
                    className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    ⚡ {claiming === o.id ? 'Aceitando...' : 'ACEITAR PEDIDO'}
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          // Histórico
          entregues.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <History className="w-14 h-14 mx-auto mb-3 opacity-40" />
              <p>Nenhuma entrega concluída ainda.</p>
              <p className="text-xs mt-1">Suas entregas finalizadas aparecerão aqui.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {entregues.map(o => (
                <div key={o.id} className="bg-slate-900 border border-emerald-500/20 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-black text-emerald-400">#{o.order_number}</span>
                    <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                      ✓ Entregue
                    </span>
                  </div>
                  <p className="text-sm font-semibold truncate">{o.customer_name}</p>
                  {o.delivery_address && (
                    <p className="text-xs text-slate-400 truncate flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {o.delivery_address}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-1.5 text-xs">
                    <span className="text-slate-500">{new Date(o.created_at).toLocaleString('pt-BR')}</span>
                    <span className="text-orange-500 font-bold">{formatCurrency(o.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </main>
    </div>
  );
};

export default EntregadorDashboard;
