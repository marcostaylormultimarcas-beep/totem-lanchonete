import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Clock, Loader2, Save, Plus, Trash2, AlertTriangle, Power, CalendarClock, CalendarDays } from 'lucide-react';
import { BusinessHours, DAY_KEYS, DAY_LABELS, DEFAULT_HOURS, DayKey, SpecialClosure, localDateKey, normalizeSpecialClosures } from '@/hooks/useStoreStatus';

const OperacaoPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_HOURS);
  const [emergencyClosed, setEmergencyClosed] = useState(false);
  const [closedMessage, setClosedMessage] = useState('Lanchonete fechada no momento');
  const [schedulingEnabled, setSchedulingEnabled] = useState(true);
  const [schedulingSlotMinutes, setSchedulingSlotMinutes] = useState<15 | 30>(30);
  const [schedulingCapacityEnabled, setSchedulingCapacityEnabled] = useState(false);
  const [schedulingMaxOrdersPerSlot, setSchedulingMaxOrdersPerSlot] = useState(0);
  const [schedulingPreparationLeadMin, setSchedulingPreparationLeadMin] = useState(30);
  const [specialClosures, setSpecialClosures] = useState<SpecialClosure[]>([]);
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('Folga');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('settings')
        .select('business_hours, emergency_closed, closed_message, scheduling_enabled, scheduling_slot_minutes, scheduling_capacity_enabled, scheduling_max_orders_per_slot, scheduling_preparation_lead_min, special_closures')
        .eq('organization_id', organizationId).maybeSingle();
      if (data) {
        setHours((data as any).business_hours || DEFAULT_HOURS);
        setEmergencyClosed(Boolean((data as any).emergency_closed));
        setClosedMessage((data as any).closed_message || 'Lanchonete fechada no momento');
        setSchedulingEnabled((data as any).scheduling_enabled !== false);
        setSchedulingSlotMinutes((data as any).scheduling_slot_minutes === 15 ? 15 : 30);
        setSchedulingCapacityEnabled(Boolean((data as any).scheduling_capacity_enabled));
        setSchedulingMaxOrdersPerSlot(Math.max(0, Number((data as any).scheduling_max_orders_per_slot || 0)));
        setSchedulingPreparationLeadMin(Math.max(0, Math.min(360, Number((data as any).scheduling_preparation_lead_min ?? 30))));
        setSpecialClosures(normalizeSpecialClosures((data as any).special_closures));
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
    if (schedulingCapacityEnabled && schedulingMaxOrdersPerSlot < 1) {
      toast.error('Informe pelo menos 1 pedido por intervalo ou desative o limite.');
      return;
    }
    if (schedulingPreparationLeadMin < 0 || schedulingPreparationLeadMin > 360) {
      toast.error('A antecedência de preparo deve ficar entre 0 e 360 minutos.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('settings').update({
      business_hours: hours as any,
      emergency_closed: emergencyClosed,
      closed_message: closedMessage,
      scheduling_enabled: schedulingEnabled,
      scheduling_slot_minutes: schedulingSlotMinutes,
      scheduling_capacity_enabled: schedulingCapacityEnabled,
      scheduling_max_orders_per_slot: schedulingCapacityEnabled ? schedulingMaxOrdersPerSlot : 0,
      scheduling_preparation_lead_min: schedulingPreparationLeadMin,
      special_closures: specialClosures as any,
    } as any).eq('organization_id', organizationId);
    setSaving(false);
    if (error) return toast.error('Erro: ' + error.message);
    toast.success('Operação atualizada!');
  };

  const addSpecialClosure = () => {
    if (!closureDate) {
      toast.error('Escolha a data da folga.');
      return;
    }

    const reason = closureReason.trim().slice(0, 80) || 'Folga / fechado';
    setSpecialClosures(current => normalizeSpecialClosures([
      ...current.filter(item => item.date !== closureDate),
      { date: closureDate, reason },
    ]));
    setClosureDate('');
    setClosureReason('Folga');
    toast.info('Data adicionada. Toque em "Salvar Configurações" para confirmar.');
  };

  const removeSpecialClosure = (date: string) => {
    setSpecialClosures(current => current.filter(item => item.date !== date));
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

      {/* Folgas e feriados */}
      <div className="kiosk-card p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-black text-lg">Folgas, Feriados e Dias Fechados</h2>
            <p className="text-xs text-muted-foreground">
              Programe datas em que a loja não abrirá. Elas têm prioridade sobre o horário semanal.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-[1fr_1.5fr_auto] gap-2">
          <input
            type="date"
            min={localDateKey(new Date())}
            value={closureDate}
            onChange={e => setClosureDate(e.target.value)}
            className="px-3 py-2 bg-muted rounded-lg outline-none"
          />
          <input
            value={closureReason}
            onChange={e => setClosureReason(e.target.value)}
            placeholder="Motivo: feriado, folga, manutenção..."
            maxLength={80}
            className="px-3 py-2 bg-muted rounded-lg outline-none"
          />
          <button
            type="button"
            onClick={addSpecialClosure}
            className="touch-btn px-4 py-2 rounded-lg bg-primary text-primary-foreground font-bold flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>

        {specialClosures.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Nenhuma folga ou feriado programado.
          </div>
        ) : (
          <div className="space-y-2">
            {specialClosures.map(item => {
              const date = new Date(`${item.date}T12:00:00`);
              const isToday = item.date === localDateKey(new Date());
              return (
                <div key={item.date} className="rounded-xl border border-border p-3 flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-destructive/10 text-destructive flex flex-col items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold uppercase">
                      {date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                    </span>
                    <span className="text-lg leading-none font-black">{String(date.getDate()).padStart(2, '0')}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm">
                        {date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </p>
                      {isToday && (
                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
                          HOJE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{item.reason}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSpecialClosure(item.date)}
                    className="p-2 rounded-lg text-destructive hover:bg-destructive/10"
                    aria-label={`Remover fechamento de ${item.date}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Exemplo: cadastre 25/12 como “Natal”. Nesse dia a loja ficará fechada automaticamente e a próxima abertura ignorará essa data.
        </p>
      </div>

      {/* Mensagem & Agendamento */}
      <div className="kiosk-card p-4 space-y-4">
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

        {schedulingEnabled && (
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-4">
            <div>
              <h3 className="font-black text-sm">Configuração profissional de agendamentos</h3>
              <p className="text-[11px] text-muted-foreground mt-1">
                Define os horários disponíveis, a capacidade por faixa e quanto antes o pedido entra na fila da cozinha e dos entregadores.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1 block">Intervalo dos horários</label>
                <select
                  value={schedulingSlotMinutes}
                  onChange={e => setSchedulingSlotMinutes(e.target.value === '15' ? 15 : 30)}
                  className="w-full px-3 py-2 bg-muted rounded-lg outline-none"
                >
                  <option value={15}>A cada 15 minutos</option>
                  <option value={30}>A cada 30 minutos</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1 block">Antecedência para preparo</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={360}
                    step={5}
                    value={schedulingPreparationLeadMin}
                    onChange={e => setSchedulingPreparationLeadMin(Math.max(0, Math.min(360, Number(e.target.value || 0))))}
                    className="w-full px-3 py-2 bg-muted rounded-lg outline-none"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">min</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Ex.: 30 min → pedido das 12:00 entra na operação às 11:30.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={schedulingCapacityEnabled}
                onChange={e => setSchedulingCapacityEnabled(e.target.checked)}
                className="w-5 h-5 accent-primary mt-0.5"
              />
              <span>
                <span className="font-semibold text-sm block">Limitar quantidade de pedidos por intervalo</span>
                <span className="text-[11px] text-muted-foreground">Opcional. Evita concentrar pedidos demais no mesmo horário.</span>
              </span>
            </label>

            {schedulingCapacityEnabled && (
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1 block">
                  Máximo de pedidos a cada {schedulingSlotMinutes} minutos
                </label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={schedulingMaxOrdersPerSlot || ''}
                  onChange={e => setSchedulingMaxOrdersPerSlot(Math.max(0, Math.min(999, Number(e.target.value || 0))))}
                  placeholder="Ex.: 8"
                  className="w-full px-3 py-2 bg-muted rounded-lg outline-none"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Quando atingir o limite, o cliente será orientado a escolher outro horário. Pedidos cancelados liberam a vaga.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <button onClick={save} disabled={saving}
        className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold flex items-center justify-center gap-2">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} Salvar Configurações
      </button>
    </div>
  );
};

export default OperacaoPanel;
