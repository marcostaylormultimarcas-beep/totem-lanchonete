import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const oneSignalSource = readFileSync('src/lib/onesignal.ts', 'utf8');
const panelSource = readFileSync('src/components/admin/EstoquePreditivPanel.tsx', 'utf8');

describe('predictive stock push retry contract', () => {
  it('reports success only when the backend confirms the notification was actually queued', () => {
    expect(oneSignalSource).toMatch(
      /triggerPredictiveStockAlert\([\s\S]*?\):\s*Promise<boolean>/,
    );
    expect(oneSignalSource).toMatch(
      /result\?\.ok\s*!==\s*true\s*\|\|\s*result\?\.queued\s*!==\s*true/,
    );
    expect(oneSignalSource).toMatch(/return\s+false;/);
    expect(oneSignalSource).toMatch(/return\s+true;/);
  });

  it('does not mark an alert as pushed before queue confirmation', () => {
    expect(panelSource).toMatch(
      /const\s+queued\s*=\s*await\s+triggerPredictiveStockAlert\(/,
    );
    expect(panelSource).toMatch(
      /if\s*\(queued\)\s*\{\s*pushedRef\.current\.add\(key\);\s*\}/,
    );
  });

  it('keeps an in-flight guard so concurrent recalculations do not duplicate a pending enqueue', () => {
    expect(panelSource).toContain('pushInFlightRef');
    expect(panelSource).toMatch(/pushInFlightRef\.current\.has\(key\)/);
    expect(panelSource).toMatch(/pushInFlightRef\.current\.add\(key\)/);
    expect(panelSource).toMatch(/pushInFlightRef\.current\.delete\(key\)/);
  });
});
