import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_LABELS: Record<DayKey, string> = {
  sun: 'Domingo', mon: 'Segunda', tue: 'Terça', wed: 'Quarta',
  thu: 'Quinta', fri: 'Sexta', sat: 'Sábado',
};

export type DayConfig = { enabled: boolean; windows: [string, string][] };
export type BusinessHours = Record<DayKey, DayConfig>;

export const DEFAULT_HOURS: BusinessHours = {
  sun: { enabled: false, windows: [] },
  mon: { enabled: true, windows: [['09:00', '22:00']] },
  tue: { enabled: true, windows: [['09:00', '22:00']] },
  wed: { enabled: true, windows: [['09:00', '22:00']] },
  thu: { enabled: true, windows: [['09:00', '22:00']] },
  fri: { enabled: true, windows: [['09:00', '23:00']] },
  sat: { enabled: true, windows: [['11:00', '23:00']] },
};

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export interface StoreStatus {
  loading: boolean;
  open: boolean;
  emergencyClosed: boolean;
  closingSoon: boolean; // <= 15 min para fechar
  minutesUntilClose: number | null;
  nextOpenAt: Date | null;
  message: string;
  hours: BusinessHours;
  schedulingEnabled: boolean;
}

const computeStatus = (now: Date, hours: BusinessHours): {
  open: boolean; minutesUntilClose: number | null; nextOpenAt: Date | null;
} => {
  const dayIdx = now.getDay();
  const curMin = now.getHours() * 60 + now.getMinutes();
  const today = hours[DAY_KEYS[dayIdx]];

  let open = false;
  let minutesUntilClose: number | null = null;
  if (today?.enabled) {
    for (const [start, end] of today.windows) {
      const s = toMin(start); const e = toMin(end);
      if (curMin >= s && curMin < e) { open = true; minutesUntilClose = e - curMin; break; }
    }
  }

  // Próximo horário de abertura
  let nextOpenAt: Date | null = null;
  for (let offset = 0; offset < 8; offset++) {
    const d = new Date(now); d.setDate(now.getDate() + offset);
    const cfg = hours[DAY_KEYS[d.getDay()]];
    if (!cfg?.enabled) continue;
    for (const [start] of cfg.windows) {
      const s = toMin(start);
      const candidate = new Date(d); candidate.setHours(Math.floor(s / 60), s % 60, 0, 0);
      if (candidate > now) { nextOpenAt = candidate; break; }
    }
    if (nextOpenAt) break;
  }

  return { open, minutesUntilClose, nextOpenAt };
};

export const useStoreStatus = (orgId: string | null): StoreStatus => {
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_HOURS);
  const [emergencyClosed, setEmergencyClosed] = useState(false);
  const [message, setMessage] = useState('Lanchonete fechada no momento');
  const [schedulingEnabled, setSchedulingEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase.from('settings')
        .select('business_hours, emergency_closed, closed_message, scheduling_enabled')
        .eq('organization_id', orgId).maybeSingle();
      if (cancelled) return;
      if (error) console.warn('[useStoreStatus] erro ao carregar settings:', error.message);
      if (data) {
        const hrs = (data as any).business_hours || DEFAULT_HOURS;
        const ec = Boolean((data as any).emergency_closed);
        setHours(hrs);
        setEmergencyClosed(ec);
        setMessage((data as any).closed_message || 'Lanchonete fechada no momento');
        setSchedulingEnabled((data as any).scheduling_enabled !== false);
        const { open } = computeStatus(new Date(), hrs);
        console.log('[Vitrine] Status da loja:', {
          orgId, aberto: open && !ec, emergencyClosed: ec, businessHours: hrs,
        });
      }
      setLoading(false);
    };
    load();

    const ch = supabase.channel('store-hours-' + orgId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `organization_id=eq.${orgId}` },
        (payload) => { console.log('[Vitrine] Realtime settings update:', payload.eventType); load(); })
      .subscribe((status) => console.log('[Vitrine] Realtime channel status:', status));
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [orgId]);

  // Re-render a cada 30s para manter status fresh
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const { open, minutesUntilClose, nextOpenAt } = computeStatus(new Date(), hours);
  const finalOpen = open && !emergencyClosed;
  const closingSoon = finalOpen && minutesUntilClose !== null && minutesUntilClose <= 15;

  return {
    loading, open: finalOpen, emergencyClosed, closingSoon,
    minutesUntilClose, nextOpenAt, message, hours, schedulingEnabled,
  };
};
