import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const oneSignalSource = readFileSync(join(root, 'src', 'lib', 'onesignal.ts'), 'utf8');
const adminSource = readFileSync(join(root, 'src', 'pages', 'Admin.tsx'), 'utf8');

const allSql = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort()
  .map((entry) => readFileSync(join(migrationsDir, entry), 'utf8'))
  .join('\n');

describe('OneSignal admin subscription registry lifecycle', () => {
  it('binds one durable browser instance to exactly one current subscription without collapsing multiple devices', () => {
    expect(allSql).toMatch(/onesignal_admin_push_subscriptions[\s\S]*client_instance_id\s+uuid/i);
    expect(allSql).toMatch(/unique[\s\S]*client_instance_id|unique\s+index[\s\S]*client_instance_id/i);
    expect(allSql).toMatch(/visionfood_reconcile_admin_push_subscription/i);
    expect(allSql).toMatch(/delete\s+from\s+private\.onesignal_admin_push_subscriptions[\s\S]*client_instance_id\s*=\s*cid/i);
    expect(allSql).not.toMatch(/visionfood_reconcile_admin_push_subscription[\s\S]*delete\s+from\s+private\.onesignal_admin_push_subscriptions[\s\S]*where[\s\S]*user_id\s*=\s*u\s*;/i);
  });

  it('keeps legacy rows without a browser instance out of the authoritative admin audience', () => {
    expect(allSql).toMatch(
      /visionfood_admin_push_subscription_ids[\s\S]*client_instance_id\s+is\s+not\s+null/i,
    );
  });

  it('persists a stable browser instance id and reconciles registration through the new backend contract', () => {
    expect(oneSignalSource).toContain('crypto.randomUUID()');
    expect(oneSignalSource).toContain('visionfood_onesignal_admin_client_instance_id');
    expect(oneSignalSource).toContain('visionfood_reconcile_admin_push_subscription');
    expect(oneSignalSource).toContain('_client_instance_id');
  });

  it('unregisters the persisted browser binding when permission or opt-in is no longer eligible', () => {
    expect(oneSignalSource).toContain('visionfood_unregister_admin_push_client');
    expect(oneSignalSource).toMatch(
      /syncOneSignalAdminSubscription[\s\S]*Notifications\.permission[\s\S]*PushSubscription\.optedIn[\s\S]*unregisterAdminPushClient/,
    );
  });

  it('reconciles backend registry state on subscription-id rotation and permission changes', () => {
    expect(oneSignalSource).toMatch(
      /PushSubscription\.addEventListener\(\s*['"]change['"]/,
    );
    expect(oneSignalSource).toMatch(
      /Notifications\.addEventListener\(\s*['"]permissionChange['"]/,
    );
    expect(oneSignalSource).toMatch(
      /PushSubscription\.removeEventListener\(\s*['"]change['"]/,
    );
    expect(oneSignalSource).toMatch(
      /Notifications\.removeEventListener\(\s*['"]permissionChange['"]/,
    );
    expect(adminSource).toContain('watchOneSignalAdminSubscription');
  });

  it('fails closed locally when logout cannot remove a registered admin binding', () => {
    expect(oneSignalSource).toContain('visionfood_onesignal_admin_registered');
    expect(oneSignalSource).toMatch(
      /logoutOneSignalUser[\s\S]*unregisterAdminPushClient[\s\S]*PushSubscription\.optOut\(\)[\s\S]*OneSignal\.logout\(\)/,
    );
  });
});
