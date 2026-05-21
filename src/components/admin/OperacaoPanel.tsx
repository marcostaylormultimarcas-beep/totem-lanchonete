import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Clock, Loader2, Save, Plus, Trash2, AlertTriangle, Power, CalendarClock } from 'lucide-react';
import { BusinessHours, DAY_KEYS, DAY_LABELS, DEFAULT_HOURS, DayKey } from '@/hooks/useStoreStatus';

const OperacaoPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_HOURS);
  const [emergencyClosed, setEmergencyClosed] = useState(false);
  const [closedMessage, setClosedMessage] = useState('Lanchonete fechada no momento');
  const [schedulingEnabled, setSchedulingEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('settings')
        .select('business_hours, emergency_closed, closed_message, scheduling_enabled')
        .eq('organization_id', organizationId).maybeSingle();
      if (data) {
        setHours((data as any).business_hours || DEFAULT_HOURS);
        setEmergencyClosed(Boolean((data as any).emergency_closed));
        setClosedMessage((data as any).closed_message || 'Lanchonete fechada no momento');
        setSchedulingEnabled((data as any).scheduling_enabled !== false);
      }
      setLoading(false);
    })();
  }, [organizationId]);

  const updateDay = (day: DayKey, patch: Partial<typeof hours.mon>) => {
    setHours(h => ({ ...h, [day]: { ...h[day], ...patch } }));
  };
  const updateWindow = (day: DayKey, idx: number, slot: 0 | 1, value: string) => {
    setHours(h => {
      const wins = h[day].windows.map((w, i) => {
        if (i !== idx) return w;
        const copy: [string, string] = [w[0], w[1]];
        copy[slot] = value;
        return copy;
      });
      return { ...h, [day]: { ...h[day], windows: wins } };
    });
  };
  const addWindow = (day: DayKey) => {
    setHours(h => ({ ...h, [day]: { ...h[day], windows: [...h[day].windows, ['12:00', '14:00']] } }));
  };
  const removeWindow = (day: DayKey, idx: number) => {
    setHours(h => ({ ...h, [day]: { ...h[day], windows: h[day].windows.filter((_, i) => i !== idx) } }));
  };

  const save = async () => {
    if (!organizationId) return;
    setSaving(true);
    const { error } = await supabase.from('settings').update({
      business_hours: hours as any,
      emergency_closed: emergencyClosed,
      closed_message: closedMessage,
      scheduling_enabled: schedulingEnabled,
    }).eq('organization_id', organizationId);
    setSaving(false);
    if (error) return toast.error('Erro: ' + error.message);
    toast.success('Operação atualizada!');
  };

  const toggleEmergency = async () => {
    if (!organizationId) return;
    const next = !emergencyClosed;
    setEmergencyClosed(next);
    const { error } = await supabase.from('settings').update({ emergency_closed: next }).eq('organization_id', organizationId);
    if (error) { toast.error(error.message); setEmergencyClosed(!next); return; }
    toast.success(next ? '🚨 Loja fechada em emergência!' : '✅ Loja reaberta');
  };

  if (loading) return <div className="px-4 py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;

  return (
    <div className="px-4 space-y-5 max-w-3xl pb-10">
      {/* Emergência */}
      <div className={`kiosk-card p-4 border-2 ${emergencyClosed ? 'border-destructive' : 'border-transparent'}`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${emergencyClosed ? 'bg-destructive/20' : 'bg-muted'}`}>
            <AlertTriangle className={`w-5 h-5 ${emergencyClosed ? 'text-destructive' : 'text-muted-foreground'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-lg">Status de Emergência</h2>
            <p className="text-xs text-muted-foreground">Sobrepõe os horários e bloqueia pedidos imediatamente.</p>
          </div>
        </div>
        <button onClick={toggleEmergency}
          className={`touch-btn w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 ${emergencyClosed ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground'}`}>
          <Power className="w-5 h-5" />
          {emergencyClosed ? 'Reabrir Loja' : 'Fechar Loja Agora'}
        </button>
      </div>

      {/* Horários */}
      <div className="kiosk-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><Clock className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="font-black text-lg">Horários de Funcionamento</h2>
            <p className="text-xs text-muted-foreground">Suporta múltiplas janelas por dia (ex: pausa para almoço).</p>
          </div>
        </div>

        {DAY_KEYS.map(day => (
          <div key={day} className="border border-border rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 font-bold">
                <input type="checkbox" checked={hours[day].enabled}
                  onChange={e => updateDay(day, { enabled: e.target.checked })}
                  className="w-4 h-4 accent-primary" />
                {DAY_LABELS[day]}
              </label>
              {hours[day].enabled && (
                <button onClick={() => addWindow(day)} className="text-xs text-primary flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Adicionar horário
                </button>
              )}
            </div>
            {hours[day].enabled && (
              <div className="space-y-2">
                {hours[day].windows.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sem janelas — clique em "Adicionar horário".</p>
                )}
                {hours[day].windows.map((win, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input type="time" value={win[0]} onChange={e => updateWindow(day, idx, 0, e.target.value)}
                      className="px-2 py-1.5 bg-muted rounded-md outline-none w-28" />
                    <span className="text-muted-foreground">até</span>
                    <input type="time" value={win[1]} onChange={e => updateWindow(day, idx, 1, e.target.value)}
                      className="px-2 py-1.5 bg-muted rounded-md outline-none w-28" />
                    <button onClick={() => removeWindow(day, idx)} className="p-1.5 rounded-md hover:bg-destructive/15 text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Mensagem & Agendamento */}
      <div className="kiosk-card p-4 space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Mensagem exibida quando fechado</label>
          <input value={closedMessage} onChange={e => setClosedMessage(e.target.value)}
            className="w-full px-3 py-2 bg-muted rounded-lg outline-none" maxLength={120} />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={schedulingEnabled} onChange={e => setSchedulingEnabled(e.target.checked)}
            className="w-5 h-5 accent-primary" />
          <CalendarClock className="w-4 h-4 text-primary" />
          <span className="font-semibold">Permitir agendamento de pedidos quando fechado</span>
        </label>
      </div>

      <button onClick={save} disabled={saving}
        className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold flex items-center justify-center gap-2">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} Salvar Configurações
      </button>
    </div>
  );
};

export default OperacaoPanel;
