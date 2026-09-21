import { useEffect, useState } from 'react';
import { fetchPublicStorefrontConfig } from '@/lib/publicStorefrontConfig';

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_LABELS: Record<DayKey, string> = {
  sun: 'Domingo', mon: 'Segunda', tue: 'Terça', wed: 'Quarta',
  thu: 'Quinta', fri: 'Sexta', sat: 'Sábado',
};

export type DayConfig = { enabled: boolean; windows: [string, string][] };
export type BusinessHours = Record<DayKey, DayConfig>;

export interface SpecialClosure {
  date: string;
  reason: string;
}

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

export const localDateKey = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const normalizeSpecialClosures = (value: unknown): SpecialClosure[] => {
  if (!Array.isArray(value)) return [];
  const byDate = new Map<string, SpecialClosure>();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const date = String(raw.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const reason = String(raw.reason || '').trim().slice(0, 80) || 'Folga / fechado';
    byDate.set(date, { date, reason });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
};

export const getSpecialClosure = (date: Date, closures: SpecialClosure[]) =>
  closures.find(closure => closure.date === localDateKey(date)) || null;

export const isSpecialClosureDate = (date: Date, closures: SpecialClosure[]) =>
  Boolean(getSpecialClosure(date, closures));

export interface StoreStatus {
  loading: boolean;
  open: boolean;
  emergencyClosed: boolean;
  specialClosure: boolean;
  specialClosureReason: string;
  specialClosures: SpecialClosure[];
  closingSoon: boolean;
  minutesUntilClose: number | null;
  nextOpenAt: Date | null;
  message: string;
  hours: BusinessHours;
  schedulingEnabled: boolean;
}

export const computeStatus = (
  now: Date,
  hours: BusinessHours,
  specialClosures: SpecialClosure[] = [],
): {
  open: boolean;
  minutesUntilClose: number | null;
  nextOpenAt: Date | null;
  specialClosure: SpecialClosure | null;
} => {
  const dayIdx = now.getDay();
  const curMin = now.getHours() * 60 + now.getMinutes();
  const today = hours[DAY_KEYS[dayIdx]];
  const todayClosure = getSpecialClosure(now, specialClosures);

  let open = false;
  let minutesUntilClose: number | null = null;

  if (!todayClosure && today?.enabled) {
    for (const [start, end] of today.windows) {
      const s = toMin(start);
      const e = toMin(end);
      if (s === e) continue;

      if (e > s) {
        if (curMin >= s && curMin < e) {
          open = true;
          minutesUntilClose = e - curMin;
          break;
        }
      } else if (curMin >= s) {
        open = true;
        minutesUntilClose = (24 * 60 - curMin) + e;

        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        if (isSpecialClosureDate(tomorrow, specialClosures)) {
          minutesUntilClose = 24 * 60 - curMin;
        }
        break;
      }
    }
  }

  if (!open && !todayClosure) {
    const previousDate = new Date(now);
    previousDate.setDate(now.getDate() - 1);
    const previous = hours[DAY_KEYS[(dayIdx + 6) % 7]];
    if (!isSpecialClosureDate(previousDate, specialClosures) && previous?.enabled) {
      for (const [start, end] of previous.windows) {
        const s = toMin(start);
        const e = toMin(end);
        if (e < s && curMin < e) {
          open = true;
          minutesUntilClose = e - curMin;
          break;
        }
      }
    }
  }

  let nextOpenAt: Date | null = null;
  for (let offset = 0; offset < 15; offset++) {
    const d = new Date(now);
    d.setDate(now.getDate() + offset);
    if (isSpecialClosureDate(d, specialClosures)) continue;

    const cfg = hours[DAY_KEYS[d.getDay()]];
    if (!cfg?.enabled) continue;

    for (const [start] of cfg.windows) {
      const s = toMin(start);
      const candidate = new Date(d);
      candidate.setHours(Math.floor(s / 60), s % 60, 0, 0);
      if (candidate > now) {
        nextOpenAt = candidate;
        break;
      }
    }
    if (nextOpenAt) break;
  }

  return { open, minutesUntilClose, nextOpenAt, specialClosure: todayClosure };
};

export const useStoreStatus = (orgId: string | null): StoreStatus => {
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_HOURS);
  const [specialClosures, setSpecialClosures] = useState<SpecialClosure[]>([]);
  const [emergencyClosed, setEmergencyClosed] = useState(false);
  const [message, setMessage] = useState('Lanchonete fechada no momento');
  const [schedulingEnabled, setSchedulingEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchPublicStorefrontConfig(orgId);
        if (cancelled) return;

        const hrs = (data.business_hours as BusinessHours | undefined) || DEFAULT_HOURS;
        const closures = normalizeSpecialClosures(data.special_closures);
        const ec = Boolean(data.emergency_closed);

        setHours(hrs);
        setSpecialClosures(closures);
        setEmergencyClosed(ec);
        setMessage(data.closed_message || 'Lanchonete fechada no momento');
        setSchedulingEnabled(data.scheduling_enabled !== false);

        const status = computeStatus(new Date(), hrs, closures);
        console.log('[Vitrine] Status da loja:', {
          orgId,
          aberto: status.open && !ec && !status.specialClosure,
          emergencyClosed: ec,
          specialClosure: status.specialClosure,
          businessHours: hrs,
        });
      } catch (error) {
        if (!cancelled) console.warn('[useStoreStatus] storefront config error:', error);
      }

      if (!cancelled) setLoading(false);
    };

    void load();
    const pollId = window.setInterval(() => { void load(); }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [orgId]);

  useEffect(() => {
    const id = window.setInterval(() => setTick(tick => tick + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  const status = computeStatus(new Date(), hours, specialClosures);
  const specialClosure = Boolean(status.specialClosure);
  const finalOpen = status.open && !emergencyClosed && !specialClosure;
  const closingSoon = finalOpen
    && status.minutesUntilClose !== null
    && status.minutesUntilClose <= 15;

  const specialClosureReason = status.specialClosure?.reason || '';
  const effectiveMessage = specialClosure
    ? `Fechado hoje · ${specialClosureReason || 'Folga programada'}`
    : message;

  return {
    loading,
    open: finalOpen,
    emergencyClosed,
    specialClosure,
    specialClosureReason,
    specialClosures,
    closingSoon,
    minutesUntilClose: status.minutesUntilClose,
    nextOpenAt: status.nextOpenAt,
    message: effectiveMessage,
    hours,
    schedulingEnabled,
  };
};
