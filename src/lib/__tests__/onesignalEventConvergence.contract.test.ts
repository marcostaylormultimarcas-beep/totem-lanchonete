import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../onesignal.ts', import.meta.url)),
  'utf8',
);

describe('OneSignal external event convergence contract', () => {
  it('subscribes to notification permission changes after SDK initialization', () => {
    expect(source).toMatch(/Notifications\.addEventListener\(\s*['"]permissionChange['"]/);
  });

  it('subscribes to push subscription changes after SDK initialization', () => {
    expect(source).toMatch(/PushSubscription\.addEventListener\(\s*['"]change['"]/);
  });

  it('does not opt a subscription back in merely because an external change event fired', () => {
    expect(source).toMatch(/function\s+handleOneSignalPermissionChange/);
    expect(source).toMatch(/function\s+handleOneSignalPushSubscriptionChange/);
  });
});
