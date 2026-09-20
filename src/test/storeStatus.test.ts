import { describe, expect, it } from 'vitest';
import { BusinessHours, DEFAULT_HOURS, computeStatus } from '../hooks/useStoreStatus';

const withHours = (patch: Partial<BusinessHours>): BusinessHours => ({
  ...DEFAULT_HOURS,
  ...patch,
});

describe('computeStatus overnight business hours', () => {
  it('keeps Sunday 12:00 -> 00:00 open at 17:11', () => {
    const hours = withHours({
      sun: { enabled: true, windows: [['12:00', '00:00']] },
    });

    const status = computeStatus(new Date(2026, 8, 20, 17, 11), hours);

    expect(status.open).toBe(true);
    expect(status.minutesUntilClose).toBe(409);
  });

  it('closes Sunday 12:00 -> 00:00 exactly at Monday 00:00', () => {
    const hours = withHours({
      sun: { enabled: true, windows: [['12:00', '00:00']] },
    });

    const status = computeStatus(new Date(2026, 8, 21, 0, 0), hours);

    expect(status.open).toBe(false);
  });

  it('carries 22:00 -> 02:00 into the next day', () => {
    const hours = withHours({
      sun: { enabled: true, windows: [['22:00', '02:00']] },
    });

    const status = computeStatus(new Date(2026, 8, 21, 1, 0), hours);

    expect(status.open).toBe(true);
    expect(status.minutesUntilClose).toBe(60);
  });

  it('keeps normal same-day windows unchanged', () => {
    const hours = withHours({
      sun: { enabled: true, windows: [['12:00', '18:00']] },
    });

    expect(computeStatus(new Date(2026, 8, 20, 17, 59), hours).open).toBe(true);
    expect(computeStatus(new Date(2026, 8, 20, 18, 0), hours).open).toBe(false);
  });
});
