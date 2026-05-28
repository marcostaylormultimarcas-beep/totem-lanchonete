import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { triggerOutForDeliveryPush } from '@/lib/onesignal';
import { Loader2, Sparkles, Truck, MapPin, Clock, Route, Send, Bike, AlertTriangle } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default Leaflet marker assets (Vite)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const MAX_PER_ROUTE = 4;

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  bairro_nome: string;
  delivery_distance_km: number | null;
  created_at: string;
  total: number;
}
interface Entregador { id: string; name: string; active: boolean; }
interface RouteGroup {
  id: string;
  bairros: string[];
  orders: Order[];
  totalKm: number;
  etaMin: number;
  entregadorId: string;
}
interface StoreCoords { lat: number | null; lng: number | null; }

const RoteirizacaoIAPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [loading, setLoading] = useState(false);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [entregadores, setEntregadores] = useState<Entregador[]>([]);
  const [routes, setRoutes] = useState<RouteGroup[]>([]);
  const [store, setStore] = useState<StoreCoords>({ lat: null, lng: null });
  const [generated, setGenerated] = useState(false);
  const mapRef = useRef<any>(null);

  const loadAll = async () => {
    if (!organizationId) return;
    setLoading(true);
    const [{ data: ords }, { data: ents }, { data: cfg }] = await Promise.all([
      supabase.from('orders')
        .select('id,order_number,customer_name,customer_phone,delivery_address,bairro_nome,delivery_distance_km,created_at,total,status,order_type')
        .eq('organization_id', organizationId)
        .eq('status', 'preparing')
        .eq('order_type', 'delivery')
        .order('delivery_distance_km', { ascending: true, nullsFirst: false }),
      supabase.from('entregadores').select('id,name,active').eq('organization_id', organizationId).eq('active', true),
      supabase.from('settings').select('cep_lat,cep_lng').eq('organization_id', organizationId).maybeSingle(),
    ]);
    setOrders((ords as any) || []);
    setEntregadores((ents as any) || []);
    setStore({ lat: (cfg as any)?.cep_lat ?? null, lng: (cfg as any)?.cep_lng ?? null });
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [organizationId]);

  // Tempo de espera de cada pedido em minutos
  const waitMinutes = (createdAt: string) => Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000));

  /** Algoritmo de roteirização:
   * 1. Agrupa pedidos por bairro (normalizado).
   * 2. Ordena cada grupo do mais próximo ao mais distante (delivery_distance_km).
   * 3. Quebra em lotes de até MAX_PER_ROUTE entregas (para o lanche não esfriar).
   * 4. Mescla bairros vizinhos (limítrofes) quando o lote ficaria com 1 entrega solitária —
   *    aproximação: bairros com distâncias < 1.5km de diferença são considerados vizinhos.
   * 5. Calcula ETA assumindo 25km/h + 4 min por parada.
   */
  const generateRoutes = () => {
    if (orders.length === 0) { setRoutes([]); setGenerated(true); return; }
    const norm = (s: string) => (s || 'Sem bairro').trim().toLowerCase();

    // Agrupa por bairro
    const byBairro = new Map<string, Order[]>();
    for (const o of orders) {
      const k = norm(o.bairro_nome);
      if (!byBairro.has(k)) byBairro.set(k, []);
      byBairro.get(k)!.push(o);
    }
    // Ordena cada bairro por distância
    for (const arr of byBairro.values()) {
      arr.sort((a, b) => (a.delivery_distance_km ?? 99) - (b.delivery_distance_km ?? 99));
    }

    // Lista de bairros ordenada pela distância média (mais próximo primeiro)
    const bairros = Array.from(byBairro.entries())
      .map(([k, list]) => ({
        key: k,
        nome: list[0]?.bairro_nome || k,
        list,
        avg: list.reduce((s, o) => s + (o.delivery_distance_km ?? 5), 0) / list.length,
      }))
      .sort((a, b) => a.avg - b.avg);

    const out: RouteGroup[] = [];
    let routeIdx = 1;
    let i = 0;
    while (i < bairros.length) {
      const current = bairros[i];
      let batch = [...current.list];
      const bairrosUsados = [current.nome];

      // Mescla com bairros vizinhos enquanto couber e a distância média for próxima (<=1.5km diff)
      let j = i + 1;
      while (batch.length < MAX_PER_ROUTE && j < bairros.length) {
        const neighbor = bairros[j];
        if (Math.abs(neighbor.avg - current.avg) <= 1.5) {
          const free = MAX_PER_ROUTE - batch.length;
          batch = batch.concat(neighbor.list.slice(0, free));
          bairrosUsados.push(neighbor.nome);
          if (neighbor.list.length > free) {
            // sobra entra na próxima rota
            bairros[j] = { ...neighbor, list: neighbor.list.slice(free) };
            break;
          } else {
            j++;
          }
        } else break;
      }

      // Quebra o bairro atual em múltiplos lotes se sobrou
      if (batch.length === current.list.length && j > i + 1) i = j;
      else if (batch.length < current.list.length) {
        bairros[i] = { ...current, list: current.list.slice(batch.length) };
      } else { i = j > i ? j : i + 1; }

      // Reordena batch por distância crescente (trajeto perto → longe)
      batch.sort((a, b) => (a.delivery_distance_km ?? 99) - (b.delivery_distance_km ?? 99));

      const totalKm = batch.reduce((s, o) => s + (o.delivery_distance_km ?? 0), 0);
      const etaMin = Math.round((totalKm / 25) * 60 + batch.length * 4);

      out.push({
        id: `r${routeIdx++}`,
        bairros: Array.from(new Set(bairrosUsados)),
        orders: batch,
        totalKm,
        etaMin,
        entregadorId: '',
      });
    }
    setRoutes(out);
    setGenerated(true);
  };

  const setEntregador = (rid: string, eid: string) =>
    setRoutes(rs => rs.map(r => r.id === rid ? { ...r, entregadorId: eid } : r));

  const dispatchRoute = async (route: RouteGroup) => {
    if (!route.entregadorId) { alert('Selecione um motoboy antes de despachar.'); return; }
    setDispatching(route.id);
    try {
      const ids = route.orders.map(o => o.id);
      const { error } = await supabase
        .from('orders')
        .update({ status: 'out_for_delivery', entregador_id: route.entregadorId, updated_at: new Date().toISOString() })
        .in('id', ids);
      if (error) { alert('Erro ao despachar: ' + error.message); setDispatching(null); return; }

      // Push para clientes (best-effort)
      await triggerOutForDeliveryPush(route.orders.map(o => o.customer_phone));

      // Atualiza UI
      setRoutes(rs => rs.filter(r => r.id !== route.id));
      setOrders(os => os.filter(o => !ids.includes(o.id)));
    } finally {
      setDispatching(null);
    }
  };

  const center: [number, number] = useMemo(() => {
    if (store.lat && store.lng) return [Number(store.lat), Number(store.lng)];
    return [-23.55, -46.63]; // fallback SP
  }, [store]);

  // Pinos sintéticos por bairro (sem geocode real): distribui ao redor da loja conforme a distância
  const fakePin = (route: RouteGroup, idx: number, sub: number): [number, number] => {
    const km = route.orders[sub]?.delivery_distance_km ?? 1;
    const angle = (idx * 60 + sub * 25) * (Math.PI / 180);
    const dLat = (km / 111) * Math.cos(angle);
    const dLng = (km / (111 * Math.cos(center[0] * Math.PI / 180))) * Math.sin(angle);
    return [center[0] + dLat, center[1] + dLng];
  };

  const ROUTE_COLORS = ['#f5b942', '#e8a020', '#d97706', '#fbbf24', '#facc15'];

  return (
    <div className="min-h-[80vh] bg-zinc-950 -m-4 p-4 md:p-6 text-zinc-100">
      <header className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center shadow-lg shadow-amber-900/30">
            <Route className="w-5 h-5 text-zinc-950" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight bg-gradient-to-r from-amber-200 to-yellow-400 bg-clip-text text-transparent">
              Roteirização Inteligente com IA
            </h2>
            <p className="text-xs text-zinc-400">Agrupa pedidos prontos por bairros vizinhos e gera trajeto otimizado para cada motoboy.</p>
          </div>
        </div>
        <button
          onClick={generateRoutes}
          disabled={loading || orders.length === 0}
          className="touch-btn px-5 py-3 rounded-xl text-sm font-bold inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 text-zinc-950 shadow-lg shadow-amber-900/40 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-4 h-4" />
          GERAR ROTAS OTIMIZADAS COM IA
        </button>
      </header>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* Sidebar: pedidos prontos */}
        <aside className="rounded-2xl bg-zinc-900 border border-zinc-800/80 p-4 max-h-[78vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-widest text-amber-400/80 font-bold">Pedidos prontos</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">{orders.length}</span>
          </div>
          {loading ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-amber-400" /></div>
          ) : orders.length === 0 ? (
            <div className="text-center text-xs text-zinc-500 py-8">
              <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Nenhum pedido em preparo aguardando rota.
            </div>
          ) : (
            <div className="space-y-2">
              {orders.map(o => (
                <div key={o.id} className="rounded-xl bg-zinc-950/60 border border-zinc-800 p-3 hover:border-amber-500/40 transition">
                  <div className="flex justify-between items-start gap-2">
                    <p className="font-bold text-sm">#{o.order_number}</p>
                    <span className="text-[10px] text-amber-300/90 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {waitMinutes(o.created_at)} min
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300 truncate">{o.customer_name}</p>
                  <p className="text-[11px] text-zinc-500 flex items-center gap-1 mt-1">
                    <MapPin className="w-3 h-3" /> {o.bairro_nome || 'Sem bairro'}
                    {o.delivery_distance_km != null && <span className="text-amber-400/80">· {Number(o.delivery_distance_km).toFixed(1)}km</span>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Mapa + Rotas */}
        <section className="space-y-4">
          <div className="rounded-2xl overflow-hidden border border-zinc-800/80 bg-zinc-900" style={{ height: 360 }}>
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} ref={mapRef as any}>
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker position={center}>
                <Popup>🏪 Loja</Popup>
              </Marker>
              {routes.map((r, idx) => {
                const pts: [number, number][] = [center, ...r.orders.map((_, sub) => fakePin(r, idx, sub))];
                return (
                  <>
                    <Polyline key={`pl-${r.id}`} positions={pts} pathOptions={{ color: ROUTE_COLORS[idx % ROUTE_COLORS.length], weight: 4, opacity: 0.85 }} />
                    {r.orders.map((o, sub) => (
                      <Marker key={`mk-${o.id}`} position={fakePin(r, idx, sub)}>
                        <Popup>
                          <b>#{o.order_number}</b><br />
                          {o.customer_name}<br />
                          {o.bairro_nome}
                        </Popup>
                      </Marker>
                    ))}
                  </>
                );
              })}
            </MapContainer>
          </div>

          {!store.lat && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 px-3 py-2 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Configure as coordenadas da loja em <b>Área CEP</b> para o mapa mostrar o ponto exato.
            </div>
          )}

          {generated && routes.length === 0 && (
            <div className="rounded-2xl bg-zinc-900 border border-zinc-800/80 p-6 text-center text-sm text-zinc-400">
              Sem pedidos suficientes para gerar rotas.
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-3">
            {routes.map((r, idx) => (
              <div key={r.id} className="rounded-2xl bg-zinc-900 border border-amber-500/20 p-4 space-y-3 shadow-lg shadow-amber-950/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-widest text-amber-400/80 font-bold">Rota {idx + 1}</p>
                    <p className="font-bold text-sm">
                      {r.bairros.join(' → ')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-zinc-400">{r.orders.length} entregas</p>
                    <p className="text-xs text-amber-300 font-mono">~{r.etaMin} min · {r.totalKm.toFixed(1)}km</p>
                  </div>
                </div>

                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {r.orders.map((o, k) => (
                    <div key={o.id} className="text-xs flex items-center gap-2 text-zinc-300">
                      <span className="w-5 h-5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center justify-center text-[10px] font-bold">{k + 1}</span>
                      <span className="flex-1 truncate">#{o.order_number} · {o.customer_name}</span>
                      <span className="text-amber-400/80 font-mono shrink-0">{(o.delivery_distance_km ?? 0).toFixed(1)}km</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <select
                    value={r.entregadorId}
                    onChange={(e) => setEntregador(r.id, e.target.value)}
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-amber-500"
                  >
                    <option value="">Selecionar motoboy…</option>
                    {entregadores.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <button
                    onClick={() => dispatchRoute(r)}
                    disabled={!r.entregadorId || dispatching === r.id}
                    className="px-3 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-amber-500 to-yellow-600 text-zinc-950 inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    {dispatching === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    VINCULAR & ENVIAR
                  </button>
                </div>
              </div>
            ))}
          </div>

          {entregadores.length === 0 && (
            <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-xs text-zinc-400 flex items-center gap-2">
              <Bike className="w-4 h-4 text-amber-400" />
              Cadastre motoboys ativos na aba <b className="text-zinc-200">Entregadores</b> para conseguir despachar rotas.
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default RoteirizacaoIAPanel;
