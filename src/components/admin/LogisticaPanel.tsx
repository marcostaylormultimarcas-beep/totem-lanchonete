import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Truck, Users, Zap, KeyRound, Loader2, MapPin, Package, RefreshCw, Send } from 'lucide-react';

type Mode = 'manual' | 'free';

interface ReadyOrder {
  id: string;
  order_number: string;
  customer_name: string;
  delivery_address: string | null;
  bairro_nome: string | null;
  total: number;
}

interface Entregador {
  id: string;
  name: string;
  active: boolean;
}

const LogisticaPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [mode, setMode] = useState<Mode>('manual');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Roteirização por região (lógica simples)
  const [readyOrders, setReadyOrders] = useState<ReadyOrder[]>([]);
  const [entregadores, setEntregadores] = useState<Entregador[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState<Record<string, string>>({}); // bairro -> entregadorId
  const [dispatching, setDispatching] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('settings')
        .select('delivery_assignment_mode')
        .eq('organization_id', organizationId)
        .maybeSingle();
      const m = ((data as any)?.delivery_assignment_mode || 'manual') as Mode;
      setMode(m === 'free' ? 'free' : 'manual');
      setLoading(false);
    })();
  }, [organizationId]);

  const save = async (next: Mode) => {
    if (!organizationId) return;
    setSaving(true);
    setMode(next);
    const { error } = await supabase
      .from('settings')
      .update({ delivery_assignment_mode: next } as any)
      .eq('organization_id', organizationId);
    setSaving(false);
    if (error) {
      toast.error('Erro ao salvar: ' + error.message);
      return;
    }
    toast.success(next === 'manual' ? 'Modo Atribuição Manual ativado.' : 'Modo Disputa Livre ativado.');
  };

  const fetchRouting = async () => {
    if (!organizationId) return;
    setLoadingRoutes(true);
    const [ordersRes, entRes] = await Promise.all([
      supabase
        .from('orders')
        .select('id, order_number, customer_name, delivery_address, bairro_nome, total, status, order_type, entregador_id')
        .eq('organization_id', organizationId)
        .eq('status', 'ready')
        .is('entregador_id', null)
        .order('created_at', { ascending: true }),
      supabase
        .from('entregadores' as any)
        .select('id, name, active')
        .eq('organization_id', organizationId)
        .eq('active', true)
        .order('name'),
    ]);
    // Mantém apenas pedidos com endereço/bairro (entregas)
    const rows = ((ordersRes.data as any[]) || []).filter(
      (o) => o.delivery_address || o.bairro_nome
    );
    setReadyOrders(rows as any);
    setEntregadores(((entRes.data as any[]) || []) as any);
    setLoadingRoutes(false);
    setShowGroups(true);
    setSelectedIds(new Set(rows.map((r: any) => r.id)));
    if (rows.length === 0) {
      toast.info('Nenhum pedido pronto para entrega no momento.');
    } else {
      toast.success(`${rows.length} pedido(s) pronto(s) encontrado(s).`);
    }
  };

  const grupos = useMemo(() => {
    const map = new Map<string, ReadyOrder[]>();
    readyOrders.forEach((o) => {
      const key = (o.bairro_nome || 'Sem bairro').trim() || 'Sem bairro';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    });
    return Array.from(map.entries())
      .map(([bairro, items]) => ({ bairro, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [readyOrders]);

  const toggleOrder = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleGrupo = (items: ReadyOrder[]) => {
    const ids = items.map((i) => i.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const dispatchGrupo = async (bairro: string, items: ReadyOrder[]) => {
    const entregadorId = assignTo[bairro];
    if (!entregadorId) {
      toast.error('Selecione um entregador para este bairro.');
      return;
    }
    const ids = items.map((i) => i.id).filter((id) => selectedIds.has(id));
    if (ids.length === 0) {
      toast.error('Nenhum pedido selecionado neste grupo.');
      return;
    }
    setDispatching(true);
    const { error } = await supabase
      .from('orders')
      .update({
        entregador_id: entregadorId,
        status: 'out_for_delivery',
        updated_at: new Date().toISOString(),
      } as any)
      .in('id', ids);
    setDispatching(false);
    if (error) {
      toast.error('Erro ao despachar lote: ' + error.message);
      return;
    }
    const entNome = entregadores.find((e) => e.id === entregadorId)?.name || 'entregador';
    toast.success(`🛵 ${ids.length} pedido(s) do bairro ${bairro} enviados para ${entNome}.`);
    // remove despachados da lista
    setReadyOrders((prev) => prev.filter((o) => !ids.includes(o.id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  if (loading) {
    return (
      <div className="px-4 py-10 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  const Option = ({
    value, title, desc, icon: Icon,
  }: { value: Mode; title: string; desc: string; icon: any }) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => !saving && save(value)}
        className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex gap-3 ${
          active
            ? 'border-primary bg-primary/10 shadow-[0_0_25px_-10px_hsl(var(--primary))]'
            : 'border-border bg-card hover:border-primary/40'
        }`}
      >
        <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
          active ? 'border-primary' : 'border-muted-foreground/40'
        }`}>
          {active && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon className={`w-4 h-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className={`font-black ${active ? 'text-primary' : 'text-foreground'}`}>{title}</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
        </div>
      </button>
    );
  };

  return (
    <div className="px-4 space-y-4">
      <div className="flex items-center gap-2">
        <Truck className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-black">Configurações de Logística</h2>
        {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />}
      </div>

      <div className="kiosk-card p-4 space-y-3">
        <p className="text-sm font-bold">Modo de Atribuição de Entregas</p>
        <p className="text-xs text-muted-foreground">
          Escolha como os pedidos de entrega serão distribuídos para sua equipe de entregadores.
        </p>

        <div className="space-y-3">
          <Option
            value="manual"
            title="Atribuição Manual (Controle Total)"
            icon={Users}
            desc="O dono ou gerente da loja escolhe exatamente qual entregador receberá cada pedido. Ideal para quem quer organizar a fila de entregas e ter total controle."
          />
          <Option
            value="free"
            title="Disputa Livre (Agilidade Máxima)"
            icon={Zap}
            desc="O pedido aparece para todos os entregadores ativos simultaneamente. O primeiro que aceitar fica com a entrega. Ideal para frotas grandes onde a rapidez é prioridade."
          />
        </div>
      </div>

      {/* ============== Roteirização por Região ============== */}
      <div className="kiosk-card p-4 space-y-3 border border-primary/30">
        <div className="flex items-center gap-2 flex-wrap">
          <MapPin className="w-5 h-5 text-primary" />
          <p className="font-black">Roteirização por Região</p>
          {showGroups && (
            <button
              onClick={fetchRouting}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Agrupa automaticamente todos os pedidos <span className="text-success font-semibold">prontos para entrega</span> pelo bairro de destino e permite atribuir um lote inteiro a um único entregador.
        </p>

        <button
          onClick={fetchRouting}
          disabled={loadingRoutes}
          className="w-full bg-gradient-to-r from-amber-400 to-orange-600 text-zinc-950 font-black py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loadingRoutes ? <Loader2 className="w-5 h-5 animate-spin" /> : <Package className="w-5 h-5" />}
          📦 Agrupar Entregas por Região
        </button>

        {showGroups && (
          <div className="space-y-3 pt-2">
            {grupos.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Nenhum pedido pronto para entrega no momento.
              </div>
            ) : (
              grupos.map(({ bairro, items }) => {
                const ids = items.map((i) => i.id);
                const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
                const allSelected = selectedCount === ids.length;
                return (
                  <div key={bairro} className="border border-border rounded-xl bg-muted/30 overflow-hidden">
                    <div className="flex items-center gap-2 p-3 bg-muted/50 flex-wrap">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => toggleGrupo(items)}
                        className="w-4 h-4 accent-primary"
                      />
                      <p className="font-bold text-sm">
                        📍 {bairro}
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          {items.length} pedido(s) • {selectedCount} selecionado(s)
                        </span>
                      </p>
                    </div>

                    <div className="divide-y divide-border/40">
                      {items.map((o) => (
                        <label
                          key={o.id}
                          className="flex items-start gap-2 p-3 text-xs cursor-pointer hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(o.id)}
                            onChange={() => toggleOrder(o.id)}
                            className="w-4 h-4 mt-0.5 accent-primary"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-foreground">
                              #{o.order_number} — {o.customer_name}
                            </p>
                            {o.delivery_address && (
                              <p className="text-muted-foreground truncate">{o.delivery_address}</p>
                            )}
                          </div>
                          <span className="text-primary font-bold text-xs">
                            R$ {Number(o.total || 0).toFixed(2)}
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="p-3 bg-muted/30 border-t border-border/40 flex flex-col sm:flex-row gap-2">
                      <select
                        value={assignTo[bairro] || ''}
                        onChange={(e) =>
                          setAssignTo((prev) => ({ ...prev, [bairro]: e.target.value }))
                        }
                        className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">Selecionar entregador…</option>
                        {entregadores.map((e) => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => dispatchGrupo(bairro, items)}
                        disabled={dispatching || !assignTo[bairro] || selectedCount === 0}
                        className="bg-success hover:bg-success/90 text-success-foreground font-bold px-4 py-2 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <Send className="w-4 h-4" />
                        Despachar Lote ({selectedCount})
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            {entregadores.length === 0 && grupos.length > 0 && (
              <p className="text-xs text-destructive text-center">
                Cadastre entregadores ativos no painel Entregadores antes de despachar.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="kiosk-card p-4 border border-primary/30 bg-primary/5 flex gap-3">
        <KeyRound className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold text-primary">Validação obrigatória com código do cliente</p>
          <p className="text-muted-foreground leading-relaxed">
            Independente do modo escolhido, o entregador <span className="font-semibold text-foreground">sempre precisa digitar o código de 4 dígitos</span> exibido no histórico de pedidos do cliente para confirmar a entrega. Sem o código, o pedido não pode ser marcado como entregue.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LogisticaPanel;
