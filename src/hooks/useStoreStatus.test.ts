import { describe, expect, it } from 'vitest';
import {
  BusinessHours,
  computeStatus,
  normalizeSpecialClosures,
} from '@/hooks/useStoreStatus';

const HOURS: BusinessHours = {
  sun: { enabled: true, windows: [['09:00', '23:00']] },
  mon: { enabled: true, windows: [['09:00', '22:00']] },
  tue: { enabled: true, windows: [['09:00', '22:00']] },
  wed: { enabled: true, windows: [['09:00', '22:00']] },
  thu: { enabled: true, windows: [['09:00', '22:00']] },
  fri: { enabled: true, windows: [['09:00', '23:00']] },
  sat: { enabled: true, windows: [['09:00', '23:00']] },
};

describe('scheduled store closures', () => {
  it('overrides the normal weekly opening hours and skips the closed date', () => {
    const now = new Date(2026, 8, 21, 12, 0, 0);
    const status = computeStatus(now, HOURS, [
      { date: '2026-09-21', reason: 'Feriado' },
    ]);

    expect(status.open).toBe(false);
    expect(status.specialClosure?.reason).toBe('Feriado');
    expect(status.nextOpenAt).not.toBeNull();
    expect(status.nextOpenAt?.getDate()).toBe(22);
    expect(status.nextOpenAt?.getHours()).toBe(9);
  });

  it('does not carry an overnight window into a programmed closed date', () => {
    const overnight: BusinessHours = {
      ...HOURS,
      sun: { enabled: true, windows: [['22:00', '02:00']] },
    };
    const now = new Date(2026, 8, 21, 0, 30, 0);

    const status = computeStatus(now, overnight, [
      { date: '2026-09-21', reason: 'Folga' },
    ]);

    expect(status.open).toBe(false);
    expect(status.specialClosure?.reason).toBe('Folga');
  });

  it('normalizes, deduplicates and orders programmed dates', () => {
    expect(normalizeSpecialClosures([
      { date: '2026-12-25', reason: 'Natal' },
      { date: 'invalid', reason: 'Ignorar' },
      { date: '2026-09-21', reason: 'Feriado' },
      { date: '2026-09-21', reason: 'Folga especial' },
    ])).toEqual([
      { date: '2026-09-21', reason: 'Folga especial' },
      { date: '2026-12-25', reason: 'Natal' },
    ]);
  });
});
