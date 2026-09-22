import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, LogOut, CheckCircle2, MapPin, Phone, Package, RefreshCw, KeyRound, History, Clock, Map as MapIcon, Navigation } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getEntregadorSession, clearEntregadorSession } from './EntregadorLogin';
import { formatCurrency } from '@/data/store';
import LiveDeliveryMap from '@/components/LiveDeliveryMap';
import { geocodeAddress } from '@/lib/cep';
import { googleMapsDirectionsUrl, MAX_DRIVER_CONFIRM_ACCURACY_M, MAX_EXACT_DESTINATION_ACCURACY_M } from '@/lib/deliveryRouting';

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
  scheduled_for?: string | null;
  bairro_nome?: string;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  delivery_accuracy_m?: number | null;
  delivery_assigned_at?: string | null;
  delivery_started_at?: string | null;
  delivery_issue_reason?: string | null;
  delivery_issue_at?: string | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  preparing: { label: '👨‍🍳 Preparando', cls: 'bg-primary/15 text-primary border-primary/30' },
  ready: { label: '✅ Pronto p/ retirar', cls: 'bg-success/15 text-success border-success/30 animate-pulse' },
  out_for_delivery: { label: '🛵 A caminho', cls: 'bg-blue-400/15 text-blue-400 border-blue-400/30' },
  delivered: { label: '✓ Entregue', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

const EntregadorDashboard = () => {
  const navigate = useNavigate();
  const [session] = useState(() => getEntregadorSession());
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoadError, setOrdersLoadError] = useState('');
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const claimInFlightRef = useRef(false);
  const [deliveryAction, setDeliveryAction] = useState<string | null>(null);
  const startDeliveryInFlightRef = useRef(false);
  const declineOrderInFlightRef = useRef(false);
  const reportIssueInFlightRef = useRef(false);
  const [mode, setMode] = useState<'manual' | 'free'>('manual');
  const [available, setAvailable] = useState<DeliveryOrder[]>([]);
  const [availableLoadError, setAvailableLoadError] = useState('');
  const [tab, setTab] = useState<'pendentes' | 'disponiveis' | 'historico'>('pendentes');
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string>>(new Set());
  const ordersInitializedRef = useRef(false);
  const ordersRequestVersionRef = useRef(0);
  const availableRequestVersionRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const unlocked = useRef(false);
  const [, forceRender] = useState(0);
  const [mapOpenId, setMapOpenId] = useState<string | null>(null);
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number; updatedAt: string } | null>(null);
  const [destCoords, setDestCoords] = useState<Record<string, { lat: number; lng: number }>>({});
  const [geofenceError, setGeofenceError] = useState<Record<string, string | null>>({});
  const [geoChecking, setGeoChecking] = useState<string | null>(null);
  const [currentDistance, setCurrentDistance] = useState<Record<string, number>>({});
  const [refreshingLoc, setRefreshingLoc] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const sendTimerRef = useRef<number | null>(null);
  const initialSendTimerRef = useRef<number | null>(null);
  const locationRequestInFlightRef = useRef(false);
  const trackingGenerationRef = useRef(0);
  const lastSampleRef = useRef<{ lat: number; lng: number } | null>(null);

  // Raio máximo permitido para confirmar a entrega (metros)
  const MAX_DELIVERY_RADIUS_M = 200;

  // Haversine (JS puro) — distância em metros entre duas coordenadas
  const haversineMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const getExactDestination = (order: DeliveryOrder) => {
    if (typeof order.delivery_lat !== 'number' || typeof order.delivery_lng !== 'number') return null;
    const lat = order.delivery_lat;
    const lng = order.delivery_lng;
    if (
      !Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180
    ) return null;

    if (
      typeof order.delivery_accuracy_m !== 'number'
      || !Number.isFinite(order.delivery_accuracy_m)
      || order.delivery_accuracy_m <= 0
      || order.delivery_accuracy_m > MAX_EXACT_DESTINATION_ACCURACY_M
    ) {
      return null;
    }

    return { lat, lng };
  };

  const resolveDestination = async (order: DeliveryOrder) => {
    const exact = getExactDestination(order);
    if (exact) {
      setDestCoords(prev => {
        const current = prev[order.id];
        if (current?.lat === exact.lat && current?.lng === exact.lng) return prev;
        return { ...prev, [order.id]: exact };
      });
      return exact;
    }

    const cached = destCoords[order.id];
    if (cached) return cached;
    if (!order.delivery_address) return null;

    const geocoded = await geocodeAddress(order.delivery_address);
    if (geocoded) setDestCoords(prev => ({ ...prev, [order.id]: geocoded }));
    return geocoded;
  };

  const getCurrentPositionAsync = () =>
    new Promise<{ lat: number; lng: number; accuracyM: number }>((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocalização não suportada neste dispositivo.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.max(0, Number(pos.coords.accuracy || 0)),
        }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });

  const refreshDistance = async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || (!order.delivery_address && !getExactDestination(order))) return;
    setRefreshingLoc(orderId);
    try {
      const dest = await resolveDestination(order);
      if (!dest) {
        setGeofenceError((p) => ({ ...p, [orderId]: '📍 Não foi possível localizar o endereço do cliente no mapa.' }));
        return;
      }
      const me = await getCurrentPositionAsync();
      if (me.accuracyM > MAX_DRIVER_CONFIRM_ACCURACY_M) {
        setGeofenceError((p) => ({
          ...p,
          [orderId]: `📍 GPS impreciso (±${Math.round(me.accuracyM)} m). Vá para um local com melhor sinal e atualize novamente.`,
        }));
        return;
      }
      const distM = haversineMeters(me, dest);
      setCurrentDistance((p) => ({ ...p, [orderId]: distM }));
      if (distM > MAX_DELIVERY_RADIUS_M) {
        setGeofenceError((p) => ({
          ...p,
          [orderId]: `📍 Ainda fora do raio permitido. Você está a ${Math.round(distM)} m (máx. ${MAX_DELIVERY_RADIUS_M} m).`,
        }));
      } else {
        setGeofenceError((p) => ({ ...p, [orderId]: null }));
        toast.success(`Localização OK — ${Math.round(distM)} m do cliente.`);
      }
    } catch (err: any) {
      const denied = err?.code === 1 || /denied|permission/i.test(err?.message || '');
      setGeofenceError((p) => ({
        ...p,
        [orderId]: denied
          ? '📍 Ative a permissão de localização do navegador.'
          : '📍 Não foi possível obter sua localização. Verifique o GPS.',
      }));
    } finally {
      setRefreshingLoc(null);
    }
  };




  const stopTracking = useCallback(() => {
    trackingGenerationRef.current += 1;
    locationRequestInFlightRef.current = false;
    lastSampleRef.current = null;
    if (initialSendTimerRef.current !== null) {
      clearTimeout(initialSendTimerRef.current);
      initialSendTimerRef.current = null;
    }
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (sendTimerRef.current !== null) {
      clearInterval(sendTimerRef.current);
      sendTimerRef.current = null;
    }
  }, []);

  const expireSession = useCallback(() => {
    stopTracking();
    clearEntregadorSession();
    toast.error('Sessão expirada. Faça login novamente.');
    navigate('/entregador/login', { replace: true });
  }, [navigate, stopTracking]);

  const isInvalidSession = (res: any) => res?.reason === 'invalid_session' || res?.reason === 'invalid_credentials';

  const startTracking = useCallback((orderId: string) => {
    if (!session) return;
    if (!('geolocation' in navigator)) {
      toast.error('Seu dispositivo não suporta geolocalização.');
      return;
    }
    stopTracking();
    const trackingGeneration = trackingGenerationRef.current;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        lastSampleRef.current = { lat, lng };
        setRiderPos({ lat, lng, updatedAt: new Date().toISOString() });
      },
      (err) => {
        toast.error('Permissão de localização negada.');
        console.warn('geolocation error', err);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    // envia a cada 15s
    const send = async () => {
      if (trackingGeneration !== trackingGenerationRef.current || locationRequestInFlightRef.current) return;
      const p = lastSampleRef.current;
      if (!p) return;
      locationRequestInFlightRef.current = true;
      try {
        const { data } = await supabase.rpc('entregador_update_location_session' as any, {
          _session_token: session.session_token,
          _lat: p.lat,
          _lng: p.lng,
          _order_id: orderId,
        });
        if (trackingGeneration !== trackingGenerationRef.current) return;
        if (isInvalidSession(data)) expireSession();
        const result: any = data;
        if (isInvalidSession(data)) return;
        if (result?.reason === 'order_not_assigned') {
          stopTracking();
          setMapOpenId(null);
          setRiderPos(null);
          toast.info('Esta entrega não está mais atribuída a você. O rastreamento foi encerrado.');
        }
      } finally {
        if (trackingGeneration === trackingGenerationRef.current) locationRequestInFlightRef.current = false;
      }
    };
    sendTimerRef.current = window.setInterval(send, 15000);
    // primeiro envio rápido; cancelável ao fechar mapa/logout/expirar sessão
    initialSendTimerRef.current = window.setTimeout(() => {
      initialSendTimerRef.current = null;
      void send();
    }, 2500);
  }, [session, stopTracking, expireSession]);

  useEffect(() => () => stopTracking(), [stopTracking]);

  const toggleMap = async (order: DeliveryOrder) => {
    if (mapOpenId === order.id) {
      setMapOpenId(null);
      setRiderPos(null);
      stopTracking();
      return;
    }
    setMapOpenId(order.id);
    setRiderPos(null);
    startTracking(order.id);
    if (order.delivery_address || getExactDestination(order)) {
      await resolveDestination(order);
    }
  };

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

    const requestId = ++ordersRequestVersionRef.current;
    if (!ordersInitializedRef.current) {
      setLoading(true);
    }

    try {
      const { data, error } = await supabase.rpc('entregador_orders_session' as any, {
        _session_token: session.session_token,
      });
      if (requestId !== ordersRequestVersionRef.current) return;

      const res: any = data;
      if (error) throw error;
      if (!res?.ok) {
        if (isInvalidSession(res)) {
          expireSession();
          return;
        }
        if (!ordersInitializedRef.current) {
          setOrdersLoadError('Não foi possível carregar seus pedidos agora. Tente novamente.');
        }
        return;
      }

      const list: DeliveryOrder[] = Array.isArray(res.orders) ? res.orders : [];
      // Detecta pedidos NOVOS atribuídos (ainda não entregues) para alerta sonoro.
      // Remove IDs que deixaram a atribuição para que uma futura reatribuição ao
      // mesmo entregador seja notificada novamente.
      const ativos = list.filter(o => o.status !== 'delivered');
      const activeIds = new Set(ativos.map(o => o.id));
      for (const id of Array.from(knownIds.current)) {
        if (!activeIds.has(id)) knownIds.current.delete(id);
      }
      const novos = ativos.filter(o => !knownIds.current.has(o.id));
      if (!silent && ordersInitializedRef.current && novos.length > 0) {
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
      ordersInitializedRef.current = true;
      setOrdersLoadError('');

      if (mapOpenId && !ativos.some(o => o.id === mapOpenId)) {
        setMapOpenId(null);
        setRiderPos(null);
        stopTracking();
      }
      setOrders(list);
    } catch (error) {
      if (requestId !== ordersRequestVersionRef.current) return;
      console.error('[EntregadorDashboard] orders load failed:', error);
      if (!ordersInitializedRef.current) {
        setOrdersLoadError('Não foi possível carregar seus pedidos agora. Verifique a conexão e tente novamente.');
      } else {
        console.warn('[EntregadorDashboard] background orders refresh failed; keeping the last valid list visible.');
      }
    } finally {
      if (requestId === ordersRequestVersionRef.current) setLoading(false);
    }
  }, [session, playAlert, expireSession, mapOpenId, stopTracking]);

  const fetchAvailable = useCallback(async () => {
    if (!session) return;

    const requestId = ++availableRequestVersionRef.current;
    try {
      const { data, error } = await supabase.rpc('entregador_available_orders_session' as any, {
        _session_token: session.session_token,
      });
      if (requestId !== availableRequestVersionRef.current) return;

      const res: any = data;
      if (error) throw error;
      if (!res?.ok) {
        if (isInvalidSession(res)) {
          expireSession();
          return;
        }
        setAvailableLoadError('Não foi possível atualizar os pedidos disponíveis.');
        return;
      }

      const nextMode: 'manual' | 'free' = res.mode === 'free' ? 'free' : 'manual';
      setMode(nextMode);
      setAvailable(Array.isArray(res.orders) ? res.orders : []);
      setAvailableLoadError('');

      if (nextMode === 'manual') {
        setTab(current => current === 'disponiveis' ? 'pendentes' : current);
      }
    } catch (error) {
      if (requestId !== availableRequestVersionRef.current) return;
      console.error('[EntregadorDashboard] available orders load failed:', error);
      setAvailableLoadError('Não foi possível atualizar os pedidos disponíveis. A atualização automática continuará tentando.');
    }
  }, [session, expireSession]);

  // Carga inicial + polling de segurança
  useEffect(() => {
    fetchOrders(true);
    fetchAvailable();
    const i = setInterval(() => { fetchOrders(false); fetchAvailable(); }, 15000);
    return () => {
      clearInterval(i);
      ordersRequestVersionRef.current += 1;
      availableRequestVersionRef.current += 1;
    };
  }, [fetchOrders, fetchAvailable]);

  // Sessões de entregador usam token próprio, não Supabase Auth.
  // O polling acima é o canal autoritativo e funciona sem abrir SELECT de orders para anon.

  const handleClaim = async (orderId: string) => {
    if (!session || claimInFlightRef.current) return;

    claimInFlightRef.current = true;
    setClaiming(orderId);
    try {
      const { data, error } = await supabase.rpc('entregador_claim_order_session' as any, {
        _session_token: session.session_token,
        _order_id: orderId,
      });
      const res: any = data;

      if (error) {
        console.error('[EntregadorDashboard] claim order RPC failed:', error);
        toast.error('Não foi possível aceitar o pedido agora. Verifique a conexão e tente novamente.');
        await fetchAvailable();
        return;
      }

      if (!res?.ok) {
        const msg: Record<string, string> = {
          invalid_credentials: 'Sessão inválida. Faça login novamente.',
          invalid_session: 'Sessão expirada. Faça login novamente.',
          order_not_found: 'Pedido não encontrado.',
          forbidden: 'Pedido não pertence à sua loja.',
          not_delivery: 'Este pedido não é uma entrega.',
          not_ready: 'O pedido ainda não está pronto para retirada.',
          scheduled_not_released: 'Este pedido agendado ainda não entrou na janela operacional.',
          mode_not_free: 'Modo de disputa livre não está ativo.',
          already_taken: 'Outro entregador foi mais rápido nesse pedido.',
          order_changed: 'O pedido mudou enquanto você tentava aceitar. A lista será atualizada.',
        };
        toast.error(msg[res?.reason] || 'Não foi possível aceitar o pedido.');
        if (isInvalidSession(res)) {
          expireSession();
          return;
        }
        await fetchAvailable();
        return;
      }

      toast.success('🛵 Pedido reservado para você. Retire na loja e confirme quando estiver com o pedido.');
      setAvailable(prev => prev.filter(o => o.id !== orderId));
      void fetchOrders(true);
      setTab('pendentes');
    } catch (error) {
      console.error('[EntregadorDashboard] claim order request failed:', error);
      toast.error('Não foi possível aceitar o pedido agora. Verifique a conexão e tente novamente.');
      await fetchAvailable();
    } finally {
      claimInFlightRef.current = false;
      setClaiming(null);
    }
  };

  const handleStartDelivery = async (orderId: string) => {
    if (!session || deliveryAction || startDeliveryInFlightRef.current) return;

    startDeliveryInFlightRef.current = true;
    setDeliveryAction(`start:${orderId}`);
    try {
      const { data, error } = await supabase.rpc('entregador_start_delivery_session' as any, {
        _session_token: session.session_token,
        _order_id: orderId,
      });
      const res: any = data;

      if (error) {
        console.error('[EntregadorDashboard] start delivery RPC failed:', error);
        toast.error('Não foi possível iniciar a entrega agora. Verifique a conexão e tente novamente.');
        await fetchOrders(true);
        return;
      }

      if (!res?.ok) {
        const msg: Record<string, string> = {
          invalid_session: 'Sessão expirada. Faça login novamente.',
          order_not_found: 'Pedido não encontrado.',
          forbidden: 'Pedido não pertence à sua loja.',
          not_delivery: 'Este pedido não é uma entrega.',
          not_assigned: 'Este pedido não está mais atribuído a você.',
          not_ready: 'O pedido ainda não está pronto para retirada.',
          scheduled_not_released: 'Este pedido agendado ainda não entrou na janela operacional.',
        };
        toast.error(msg[res?.reason] || 'Não foi possível iniciar a entrega.');
        if (isInvalidSession(res)) {
          expireSession();
          return;
        }
        await fetchOrders(true);
        return;
      }

      setOrders(prev => prev.map(o => o.id === orderId
        ? { ...o, status: 'out_for_delivery', delivery_issue_reason: null, delivery_issue_at: null }
        : o));
      toast.success(res?.idempotent
        ? '🛵 Esta entrega já estava iniciada. Status sincronizado.'
        : '🛵 Entrega iniciada. Agora o pedido está oficialmente a caminho.');
      void fetchOrders(true);
    } catch (error) {
      console.error('[EntregadorDashboard] start delivery request failed:', error);
      toast.error('Não foi possível iniciar a entrega agora. Verifique a conexão e tente novamente.');
      await fetchOrders(true);
    } finally {
      startDeliveryInFlightRef.current = false;
      setDeliveryAction(null);
    }
  };

  const handleDeclineOrder = async (orderId: string) => {
    if (!session || deliveryAction || declineOrderInFlightRef.current) return;

    const reason = window.prompt('Por que você não poderá realizar esta entrega? Informe um motivo para a loja.');
    if (reason == null) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      toast.error('Informe um motivo com pelo menos 3 caracteres.');
      return;
    }
    if (cleanReason.length > 300) {
      toast.error('O motivo deve ter no máximo 300 caracteres.');
      return;
    }

    declineOrderInFlightRef.current = true;
    setDeliveryAction(`decline:${orderId}`);
    try {
      const { data, error } = await supabase.rpc('entregador_decline_order_session' as any, {
        _session_token: session.session_token,
        _order_id: orderId,
        _reason: cleanReason,
      });
      const res: any = data;

      if (error) {
        console.error('[EntregadorDashboard] decline order RPC failed:', error);
        toast.error('Não foi possível devolver a entrega agora. Verifique a conexão e tente novamente.');
        await fetchOrders(true);
        return;
      }

      if (!res?.ok) {
        const msg: Record<string, string> = {
          invalid_credentials: 'Sessão inválida. Faça login novamente.',
          invalid_session: 'Sessão expirada. Faça login novamente.',
          order_not_found: 'Pedido não encontrado.',
          forbidden: 'Pedido não pertence à sua loja.',
          not_assigned: 'Este pedido não está mais atribuído a você.',
          already_picked_up: 'A entrega já foi iniciada. Use “Problema na entrega” para avisar a loja.',
          reason_required: 'Informe um motivo entre 3 e 300 caracteres.',
          status_locked: 'Este pedido não pode mais ser recusado nesta etapa.',
        };
        toast.error(msg[res?.reason] || 'Não foi possível devolver a entrega.');
        if (isInvalidSession(res)) {
          expireSession();
          return;
        }
        await fetchOrders(true);
        return;
      }

      const returnedToQueue = res?.returned_to_queue === true;
      setOrders(prev => prev.filter(o => o.id !== orderId));
      stopTracking();
      if (mapOpenId === orderId) setMapOpenId(null);
      setRiderPos(null);
      await fetchAvailable();
      toast.success(returnedToQueue
        ? 'Entrega devolvida à disputa. Outro entregador poderá aceitar.'
        : 'Entrega devolvida para a loja escolher outro entregador.');
      setTab(returnedToQueue ? 'disponiveis' : 'pendentes');
    } catch (error) {
      console.error('[EntregadorDashboard] decline order request failed:', error);
      toast.error('Não foi possível devolver a entrega agora. Verifique a conexão e tente novamente.');
      await fetchOrders(true);
    } finally {
      declineOrderInFlightRef.current = false;
      setDeliveryAction(null);
    }
  };

  const handleReportIssue = async (orderId: string) => {
    if (!session || deliveryAction || reportIssueInFlightRef.current) return;

    const reason = window.prompt('Descreva o problema na entrega. A loja será avisada e decidirá o próximo passo.');
    if (reason == null) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      toast.error('Descreva o problema com pelo menos 3 caracteres.');
      return;
    }
    if (cleanReason.length > 500) {
      toast.error('A descrição do problema deve ter no máximo 500 caracteres.');
      return;
    }

    reportIssueInFlightRef.current = true;
    setDeliveryAction(`issue:${orderId}`);
    try {
      const { data, error } = await supabase.rpc('entregador_report_delivery_issue_session' as any, {
        _session_token: session.session_token,
        _order_id: orderId,
        _reason: cleanReason,
      });
      const res: any = data;

      if (error) {
        console.error('[EntregadorDashboard] report issue RPC failed:', error);
        toast.error('Não foi possível registrar o problema agora. Verifique a conexão e tente novamente.');
        return;
      }

      if (!res?.ok) {
        const msg: Record<string, string> = {
          invalid_credentials: 'Sessão inválida. Faça login novamente.',
          invalid_session: 'Sessão expirada. Faça login novamente.',
          order_not_found: 'Pedido não encontrado.',
          forbidden: 'Pedido não pertence à sua loja.',
          not_assigned: 'Este pedido não está mais atribuído a você.',
          reason_required: 'Descreva o problema entre 3 e 500 caracteres.',
          not_out_for_delivery: 'A entrega ainda não foi iniciada.',
        };
        toast.error(msg[res?.reason] || 'Não foi possível registrar o problema.');
        if (isInvalidSession(res)) expireSession();
        return;
      }

      setOrders(prev => prev.map(o => o.id === orderId
        ? { ...o, delivery_issue_reason: cleanReason }
        : o));
      toast.success('⚠️ Problema comunicado à loja. Aguarde orientação antes de abandonar a entrega.');
      void fetchOrders(true);
    } catch (error) {
      console.error('[EntregadorDashboard] report issue request failed:', error);
      toast.error('Não foi possível registrar o problema agora. Verifique a conexão e tente novamente.');
    } finally {
      reportIssueInFlightRef.current = false;
      setDeliveryAction(null);
    }
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

    // ====== TRAVA DE SEGURANÇA (Geofence 200m) ======
    const order = orders.find((o) => o.id === orderId);
    if (order && (order.delivery_address || getExactDestination(order))) {
      setGeoChecking(orderId);
      setGeofenceError((p) => ({ ...p, [orderId]: null }));
      try {
        const dest = await resolveDestination(order);
        if (!dest) {
          setGeoChecking(null);
          setGeofenceError((p) => ({
            ...p,
            [orderId]: '📍 Não foi possível localizar o endereço do cliente no mapa. Confirme o endereço com a loja.',
          }));
          return;
        }
        const me = await getCurrentPositionAsync();
        if (me.accuracyM > MAX_DRIVER_CONFIRM_ACCURACY_M) {
          setGeoChecking(null);
          setGeofenceError((p) => ({
            ...p,
            [orderId]: `📍 GPS impreciso (±${Math.round(me.accuracyM)} m). Vá para um local com melhor sinal e tente novamente.`,
          }));
          return;
        }
        const distM = haversineMeters(me, dest);
        setCurrentDistance((p) => ({ ...p, [orderId]: distM }));
        if (distM > MAX_DELIVERY_RADIUS_M) {
          setGeoChecking(null);
          setGeofenceError((p) => ({
            ...p,
            [orderId]: `📍 Ação Bloqueada! Você precisa estar próximo ao endereço do cliente para finalizar esta entrega. Vá até o local. (você está a ${Math.round(distM)} m)`,
          }));
          return;
        }
        const { data: locationData, error: locationError } = await supabase.rpc('entregador_update_location_session' as any, {
          _session_token: session.session_token,
          _lat: me.lat,
          _lng: me.lng,
          _order_id: orderId,
        });
        const locationResult: any = locationData;
        if (locationError || !locationResult?.ok) {
          setGeoChecking(null);
          if (isInvalidSession(locationResult)) {
            expireSession();
            return;
          }
          setGeofenceError((p) => ({
            ...p,
            [orderId]: '📍 Não foi possível validar sua localização com o servidor. Tente novamente.',
          }));
          return;
        }
        setGeofenceError((p) => ({ ...p, [orderId]: null }));
      } catch (err: any) {
        setGeoChecking(null);
        const denied = err?.code === 1 || /denied|permission/i.test(err?.message || '');
        setGeofenceError((p) => ({
          ...p,
          [orderId]: denied
            ? '📍 Ative a permissão de localização do navegador para finalizar a entrega.'
            : '📍 Não foi possível obter sua localização. Verifique o GPS e tente novamente.',
        }));
        return;
      }
      setGeoChecking(null);
    }

    setConfirming(orderId);
    const { data, error } = await supabase.rpc('confirm_delivery_with_code_session' as any, {
      _session_token: session.session_token,
      _order_id: orderId,
      _code: code,
    });
    setConfirming(null);
    const res: any = data;
    if (error || !res?.ok) {
      const msg: Record<string, string> = {
        invalid_credentials: 'Sessão inválida. Faça login novamente.',
        invalid_session: 'Sessão expirada. Faça login novamente.',
        not_found: 'Pedido não encontrado.',
        order_not_found: 'Pedido não encontrado.',
        forbidden: 'Pedido não pertence à sua loja.',
        not_assigned: 'Este pedido não está atribuído a você.',
        already_delivered: 'Pedido já foi entregue.',
        cancelled: 'Pedido cancelado.',
        not_out_for_delivery: 'O pedido ainda não saiu para entrega. Atualize a lista ou fale com a loja.',
        invalid_code: res?.remaining_attempts != null
          ? `❌ Código incorreto. Restam ${res.remaining_attempts} tentativa(s).`
          : '❌ Código incorreto! Confirme com o cliente.',
        invalid_code_format: 'Digite exatamente os 4 números informados pelo cliente.',
        too_many_attempts: 'Muitas tentativas incorretas. Aguarde alguns minutos e confirme o código com o cliente.',
        driver_location_required: 'Atualize sua localização antes de finalizar a entrega.',
        driver_location_stale: 'Sua localização está desatualizada. Atualize o GPS e tente novamente.',
        delivery_geofence_exceeded: res?.distance_m != null
          ? `Você ainda está a ${Math.round(Number(res.distance_m))} m do destino. Aproxime-se do cliente.`
          : 'Você ainda está fora do raio permitido para finalizar a entrega.',
      };
      toast.error(msg[res?.reason] || 'Falha ao confirmar entrega.');
      if (isInvalidSession(res)) expireSession();
      return;
    }
    toast.success('✅ Entrega confirmada!');
    setCodeInputs(p => ({ ...p, [orderId]: '' }));
    stopTracking();
    if (mapOpenId === orderId) setMapOpenId(null);
    setRiderPos(null);
    // Move imediatamente para o Histórico via update otimista
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'delivered' } : o));
    fetchOrders(true);
  };

  const handleLogout = async () => {
    stopTracking();
    setMapOpenId(null);
    setRiderPos(null);
    try {
      await supabase.rpc('entregador_logout_session' as any, { _session_token: session?.session_token });
    } finally {
      clearEntregadorSession();
      navigate('/entregador/login');
    }
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

        {availableLoadError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
            <span className="flex-1">{availableLoadError}</span>
            <button
              type="button"
              onClick={() => void fetchAvailable()}
              className="shrink-0 font-black underline underline-offset-2"
            >
              Tentar agora
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-orange-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : ordersLoadError ? (
          <div className="text-center py-14 px-4 bg-slate-900 border border-red-500/30 rounded-2xl space-y-3">
            <RefreshCw className="w-12 h-12 mx-auto text-orange-500" />
            <p className="font-black text-slate-100">Não foi possível carregar seus pedidos</p>
            <p className="text-sm text-slate-400">{ordersLoadError}</p>
            <button
              type="button"
              onClick={() => void fetchOrders(true)}
              className="bg-orange-600 hover:bg-orange-500 text-white font-bold px-4 py-2.5 rounded-xl"
            >
              Tentar novamente
            </button>
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
              const exactDestination = getExactDestination(o);
              const navigationDestination = exactDestination || destCoords[o.id];
              const navigationUrl = navigationDestination
                ? googleMapsDirectionsUrl(navigationDestination, riderPos)
                : o.delivery_address
                  ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.delivery_address)}&travelmode=driving`
                  : '';
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

                  {o.scheduled_for && (
                    <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs">
                      <p className="font-black text-violet-300">📅 Pedido agendado</p>
                      <p className="text-slate-300 mt-0.5">
                        {new Date(o.scheduled_for).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  )}
                  <div className="text-sm space-y-1.5">
                    <p className="flex items-center gap-2"><Package className="w-3.5 h-3.5 text-slate-500" /> <span className="font-semibold">{o.customer_name}</span></p>
                    {o.customer_phone && (
                      <a href={`tel:${o.customer_phone.replace(/\D/g,'')}`} className="flex items-center gap-2 text-blue-400 hover:underline">
                        <Phone className="w-3.5 h-3.5" /> {o.customer_phone}
                      </a>
                    )}
                    {o.delivery_address && (
                      <a
                        href={navigationUrl || '#'}
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

                  {(o.status === 'preparing' || o.status === 'ready') && (
                    <div className="pt-2 border-t border-slate-800 space-y-2">
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                        <p className="text-sm font-black text-amber-300">
                          {o.status === 'ready' ? '📦 Pedido reservado para você' : '👨‍🍳 Pedido ainda em preparo'}
                        </p>
                        <p className="text-xs text-slate-300 mt-1">
                          {o.status === 'ready'
                            ? 'Retire o pedido na loja. Só depois confirme “Retirei · Iniciar entrega”.'
                            : 'Aguarde o pedido ficar pronto. Se não puder atender, devolva a atribuição agora.'}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {o.status === 'ready' && (
                          <button
                            type="button"
                            onClick={() => handleStartDelivery(o.id)}
                            disabled={deliveryAction != null}
                            className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-black py-3 rounded-xl disabled:opacity-50"
                          >
                            {deliveryAction === `start:${o.id}` ? 'Iniciando...' : '✅ Retirei · Iniciar entrega'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeclineOrder(o.id)}
                          disabled={deliveryAction != null}
                          className="w-full border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-300 font-bold py-3 rounded-xl disabled:opacity-50"
                        >
                          {deliveryAction === `decline:${o.id}` ? 'Devolvendo...' : 'Não posso realizar'}
                        </button>
                      </div>
                    </div>
                  )}

                  {o.status === 'out_for_delivery' && (
                    <div className="pt-2 border-t border-slate-800 space-y-2">
                      {o.delivery_issue_reason && (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                          <p className="font-black text-amber-300">⚠️ Problema já comunicado à loja</p>
                          <p className="text-slate-300 mt-1">{o.delivery_issue_reason}</p>
                        </div>
                      )}
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
                          disabled={confirming === o.id || geoChecking === o.id || (codeInputs[o.id] || '').length !== 4}
                          className="bg-success hover:bg-success/90 text-success-foreground font-bold px-4 rounded-xl flex items-center gap-2 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-5 h-5" />
                          {geoChecking === o.id ? '📍...' : confirming === o.id ? '...' : 'OK'}
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-800/60 border border-slate-700 px-3 py-2">
                        <div className="text-xs">
                          <span className="text-slate-400">Distância até o cliente: </span>
                          {currentDistance[o.id] != null ? (
                            <span className={`font-black ${currentDistance[o.id] <= MAX_DELIVERY_RADIUS_M ? 'text-emerald-400' : 'text-red-400'}`}>
                              {Math.round(currentDistance[o.id])} m
                            </span>
                          ) : (
                            <span className="text-slate-500 italic">não verificada</span>
                          )}
                          <span className="text-slate-500"> · máx. {MAX_DELIVERY_RADIUS_M} m</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => refreshDistance(o.id)}
                          disabled={refreshingLoc === o.id}
                          className="text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                        >
                          {refreshingLoc === o.id ? '📍...' : '📍 Atualizar Localização'}
                        </button>
                      </div>
                      {geofenceError[o.id] && (
                        <div className="rounded-xl border-2 border-red-500 bg-gradient-to-r from-red-500/20 to-amber-500/20 text-red-200 px-3 py-2 text-xs font-bold animate-pulse shadow-[0_0_20px_-4px_rgba(239,68,68,0.7)]">
                          {geofenceError[o.id]}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleReportIssue(o.id)}
                        disabled={deliveryAction != null}
                        className="w-full border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-bold py-2.5 rounded-xl disabled:opacity-50"
                      >
                        {deliveryAction === `issue:${o.id}` ? 'Comunicando...' : '⚠️ Problema na entrega'}
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={() => toggleMap(o)}
                      className="w-full bg-gradient-to-r from-amber-500 to-orange-600 text-black font-black py-3 rounded-xl flex items-center justify-center gap-2 shadow-[0_0_18px_-4px_rgba(245,158,11,0.8)] hover:brightness-110"
                    >
                      <MapIcon className="w-5 h-5" /> {mapOpenId === o.id ? 'Fechar mapa' : 'Ver localização no mapa'}
                    </button>
                    {navigationUrl && (
                      <a
                        href={navigationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full bg-blue-500 hover:bg-blue-400 text-white font-black py-3 rounded-xl flex items-center justify-center gap-2"
                      >
                        <Navigation className="w-5 h-5" /> Iniciar navegação
                      </a>
                    )}
                  </div>

                  {mapOpenId === o.id && (
                    <div className="space-y-2">
                      <LiveDeliveryMap
                        rider={riderPos}
                        destination={destCoords[o.id] ? { ...destCoords[o.id], label: o.delivery_address || 'Destino' } : null}
                        height={300}
                      />
                      <p className="text-[11px] text-amber-400/90 text-center">
                        📡 Enviando sua localização a cada 15s • {riderPos ? '✅ rastreio ativo' : 'aguardando GPS...'}
                        {exactDestination ? ' • 📍 destino GPS do cliente' : ' • 📍 destino aproximado pelo endereço'}
                      </p>
                    </div>
                  )}
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
                  <p className="text-sm font-semibold">
                    {o.bairro_nome ? `📍 Bairro: ${o.bairro_nome}` : '📍 Destino oculto até aceitar'}
                  </p>
                  {o.scheduled_for && (
                    <p className="text-xs font-bold text-violet-300">
                      📅 Agendado: {new Date(o.scheduled_for).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    Nome, telefone e endereço completo são liberados somente após você aceitar o pedido.
                  </p>
                  <button
                    onClick={() => handleClaim(o.id)}
                    disabled={claiming !== null}
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
