import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const oneSignalSource = readFileSync('src/lib/onesignal.ts', 'utf8');
const panelSource = readFileSync('src/components/admin/EstoquePreditivPanel.tsx', 'utf8');

describe('predictive stock push retry contract', () => {
  it('reports success only after the asynchronous pg_net result is confirmed', () => {
    expect(oneSignalSource).toMatch(
      /triggerPredictiveStockAlert\([\s\S]*?\):\s*Promise<boolean>/,
    );
    expect(oneSignalSource).toContain('visionfood_predictive_push_result');
    expect(oneSignalSource).toMatch(/result\?\.delivered\s*===\s*true/);
    expect(oneSignalSource).toMatch(/result\?\.failed\s*===\s*true/);
    expect(oneSignalSource).toMatch(/return\s+await\s+waitForPredictivePushResult/);
  });

  it('does not mark an alert as pushed before delivery confirmation', () => {
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
