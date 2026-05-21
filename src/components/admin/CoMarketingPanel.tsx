import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Handshake, Loader2, Send, Check, X, Pause, Play, Save, Building2, Bell, Settings2 } from 'lucide-react';

interface Org { id: string; name: string; slug: string; city: string }
interface Parceria {
  id: string;
  org_origem: string; org_parceira: string;
  status: 'pending' | 'active' | 'declined' | 'suspended';
  min_order_value: number; discount_percent: number;
  habilitada_origem: boolean; habilitada_parceira: boolean;
  org_origem_name?: string; org_parceira_name?: string;
}

const CoMarketingPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [enabled, setEnabled] = useState(true);
  const [myOrg, setMyOrg] = useState<Org | null>(null);
  const [available, setAvailable] = useState<Org[]>([]);
  const [parcerias, setParcerias] = useState<Parceria[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const [configuredIds, setConfiguredIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('parceria_configured') || '[]')); } catch { return new Set(); }
  });
  const markConfigured = (id: string) => {
    setConfiguredIds(prev => {
      const next = new Set(prev); next.add(id);
      try { localStorage.setItem('parceria_configured', JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  const reload = async () => {
    if (!organizationId) return;
    setLoading(true);
    const { data: meRow } = await supabase.from('organizations')
      .select('id,name,slug,city').eq('id', organizationId).maybeSingle();
    const me = meRow as Org | null;
    setMyOrg(me);

    const { data: othersRows } = await supabase.from('organizations')
      .select('id,name,slug,city').neq('id', organizationId);
    const others = ((othersRows || []) as Org[]).filter(o => !me?.city || (o.city || '').toLowerCase() === me.city.toLowerCase());
    setAvailable(others);

    const { data: pRows } = await supabase.from('parcerias' as any).select('*')
      .or(`org_origem.eq.${organizationId},org_parceira.eq.${organizationId}`);
    const list = ((pRows || []) as any[]) as Parceria[];
    // enrich names
    const ids = Array.from(new Set(list.flatMap(p => [p.org_origem, p.org_parceira])));
    if (ids.length) {
      const { data: namesRows } = await supabase.from('organizations').select('id,name').in('id', ids);
      const map = new Map((namesRows || []).map((r: any) => [r.id, r.name]));
      list.forEach(p => {
        p.org_origem_name = map.get(p.org_origem) as string;
        p.org_parceira_name = map.get(p.org_parceira) as string;
      });
    }
    // Detect transitions to 'active' to surface a toast
    list.forEach(p => {
      const prev = prevStatusRef.current.get(p.id);
      if (prev && prev !== 'active' && p.status === 'active') {
        const isOrigem = p.org_origem === organizationId;
        const counterpart = isOrigem ? p.org_parceira_name : p.org_origem_name;
        toast.success(`Nova parceria aceita com ${counterpart}!`, {
          description: isOrigem ? 'Configure agora a recompensa para seu cliente.' : 'Configure a recompensa em "Minhas Parcerias".',
        });
      }
      prevStatusRef.current.set(p.id, p.status);
    });
    setParcerias(list);
    setLoading(false);
  };

  useEffect(() => { reload(); }, [organizationId]);

  // Realtime: listen for parceria changes
  useEffect(() => {
    if (!organizationId) return;
    const ch = supabase.channel('parcerias-' + organizationId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parcerias' }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [organizationId]);

  const saveCity = async (city: string) => {
    if (!organizationId) return;
    await supabase.from('organizations').update({ city }).eq('id', organizationId);
    setMyOrg(m => m ? { ...m, city } : m);
    toast.success('Cidade atualizada');
    reload();
  };

  const request = async (orgId: string) => {
    const { data, error } = await supabase.rpc('parceria_request' as any, {
      _org_origem: organizationId, _org_parceira: orgId,
    });
    if (error) return toast.error(error.message);
    const r = data as any;
    if (!r?.ok) return toast.error('Não foi possível enviar: ' + r?.reason);
    toast.success('Convite enviado!');
    reload();
  };

  const respond = async (id: string, accept: boolean) => {
    setSavingId(id);
    const { error } = await supabase.rpc('parceria_respond' as any, { _parceria_id: id, _accept: accept });
    setSavingId(null);
    if (error) return toast.error(error.message);
    toast.success(accept ? 'Parceria aceita!' : 'Convite recusado');
    reload();
  };

  const setRules = async (id: string, min: number, disc: number) => {
    setSavingId(id);
    const { error } = await supabase.rpc('parceria_set_rules' as any, {
      _parceria_id: id, _min_order: min, _discount: disc,
    });
    setSavingId(null);
    if (error) return toast.error(error.message);
    markConfigured(id);
    toast.success('Regras atualizadas');
    reload();
  };

  const toggle = async (id: string, en: boolean) => {
    const { error } = await supabase.rpc('parceria_toggle' as any, { _parceria_id: id, _enabled: en });
    if (error) return toast.error(error.message);
    reload();
  };

  if (loading) return <div className="px-4 py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;

  const alreadyInPartnership = (orgId: string) => parcerias.some(p =>
    (p.org_origem === orgId || p.org_parceira === orgId) && p.status !== 'declined'
  );

  return (
    <div className="px-4 space-y-5 max-w-4xl pb-10">
      <div className="kiosk-card p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><Handshake className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="font-black text-lg">Co-Marketing &amp; Parcerias</h2>
            <p className="text-xs text-muted-foreground">Conecte-se com outras lojas da sua cidade e ofereça recompensas cruzadas aos clientes.</p>
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-5 h-5 accent-primary" />
          <span className="font-semibold">Habilitar Parcerias para esta loja</span>
        </label>
      </div>

      <div className="kiosk-card p-4">
        <label className="text-xs text-muted-foreground mb-1 block">Cidade da minha loja (usada para listar parceiros)</label>
        <div className="flex gap-2">
          <input
            defaultValue={myOrg?.city || ''}
            placeholder="Ex: São Paulo"
            onBlur={e => { if ((e.target.value || '') !== (myOrg?.city || '')) saveCity(e.target.value.trim()); }}
            className="flex-1 px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {(() => {
        const pendingMine = parcerias.filter(p => p.status === 'pending' && p.org_parceira === organizationId);
        const needsConfig = parcerias.filter(p => p.status === 'active' && p.org_origem === organizationId && !configuredIds.has(p.id));
        if (pendingMine.length === 0 && needsConfig.length === 0) return null;
        return (
          <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 space-y-2">
            {pendingMine.map(p => (
              <div key={'pend-' + p.id} className="flex items-start gap-3">
                <Bell className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-bold text-sm">Convite pendente de <span className="text-primary">{p.org_origem_name}</span></p>
                  <p className="text-xs text-muted-foreground">Aceite abaixo para começar a oferecer recompensas cruzadas.</p>
                </div>
              </div>
            ))}
            {needsConfig.map(p => (
              <div key={'cfg-' + p.id} className="flex items-start gap-3">
                <Settings2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-bold text-sm">Nova parceria aceita com <span className="text-primary">{p.org_parceira_name}</span></p>
                  <p className="text-xs text-muted-foreground">Configure agora a recompensa para seu cliente em "Minhas Parcerias".</p>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {enabled && (
        <>
          <section>
            <h3 className="font-bold mb-2 flex items-center gap-2"><Building2 className="w-4 h-4" /> Lojistas Disponíveis {myOrg?.city && <span className="text-xs text-muted-foreground font-normal">em {myOrg.city}</span>}</h3>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma outra loja encontrada {myOrg?.city ? `em ${myOrg.city}` : ''}.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {available.map(o => (
                  <div key={o.id} className="kiosk-card p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold truncate">{o.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{o.city || 'Sem cidade'} · /{o.slug}</p>
                    </div>
                    {alreadyInPartnership(o.id) ? (
                      <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">Já existe</span>
                    ) : (
                      <button onClick={() => request(o.id)} className="touch-btn bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm flex items-center gap-1">
                        <Send className="w-4 h-4" /> Solicitar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="font-bold mb-2">Minhas Parcerias</h3>
            {parcerias.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma parceria ainda.</p>}
            <div className="space-y-2">
              {parcerias.map(p => {
                const isOrigem = p.org_origem === organizationId;
                const counterpart = isOrigem ? p.org_parceira_name : p.org_origem_name;
                const myEnabled = isOrigem ? p.habilitada_origem : p.habilitada_parceira;
                const statusColor = p.status === 'active' ? 'text-success' : p.status === 'pending' ? 'text-yellow-500' : p.status === 'suspended' ? 'text-destructive' : 'text-muted-foreground';
                return (
                  <div key={p.id} className="kiosk-card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-bold">{isOrigem ? '→' : '←'} {counterpart}</p>
                        <p className={`text-xs uppercase font-bold ${statusColor}`}>{p.status}</p>
                      </div>
                      {p.status === 'pending' && !isOrigem && (
                        <div className="flex gap-2">
                          <button disabled={savingId === p.id} onClick={() => respond(p.id, true)} className="touch-btn bg-success text-success-foreground px-3 py-2 rounded-lg text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Aceitar</button>
                          <button disabled={savingId === p.id} onClick={() => respond(p.id, false)} className="touch-btn bg-destructive text-destructive-foreground px-3 py-2 rounded-lg text-sm flex items-center gap-1"><X className="w-4 h-4" /> Recusar</button>
                        </div>
                      )}
                      {p.status === 'active' && (
                        <button onClick={() => toggle(p.id, !myEnabled)} className="touch-btn bg-muted px-3 py-2 rounded-lg text-sm flex items-center gap-1">
                          {myEnabled ? <><Pause className="w-4 h-4" /> Pausar</> : <><Play className="w-4 h-4" /> Reativar</>}
                        </button>
                      )}
                    </div>

                    {p.status === 'active' && (
                      <RuleEditor
                        parceria={p}
                        saving={savingId === p.id}
                        onSave={(min, disc) => setRules(p.id, min, disc)}
                      />
                    )}
                    {p.status === 'suspended' && (
                      <p className="text-xs text-destructive">Suspensa automaticamente: uma das lojas perdeu acesso ao módulo Co-Marketing.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

const RuleEditor = ({ parceria, saving, onSave }: { parceria: Parceria; saving: boolean; onSave: (min: number, disc: number) => void }) => {
  const [min, setMin] = useState(Number(parceria.min_order_value));
  const [disc, setDisc] = useState(Number(parceria.discount_percent));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
      <div>
        <label className="text-xs text-muted-foreground">Pedido mínimo (R$)</label>
        <input type="number" min={0} value={min} onChange={e => setMin(Number(e.target.value))} className="w-full px-3 py-2 bg-muted rounded-lg outline-none" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Cupom (% no parceiro)</label>
        <input type="number" min={0} max={100} value={disc} onChange={e => setDisc(Number(e.target.value))} className="w-full px-3 py-2 bg-muted rounded-lg outline-none" />
      </div>
      <button disabled={saving} onClick={() => onSave(min, disc)} className="touch-btn bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm flex items-center gap-1 justify-center">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
      </button>
    </div>
  );
};

export default CoMarketingPanel;
