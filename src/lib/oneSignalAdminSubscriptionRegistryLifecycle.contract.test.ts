import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort();
const oneSignalSource = readFileSync(join(root, 'src', 'lib', 'onesignal.ts'), 'utf8');
const adminSource = readFileSync(join(root, 'src', 'pages', 'Admin.tsx'), 'utf8');

const allSql = migrationFiles
  .map((entry) => readFileSync(join(migrationsDir, entry), 'utf8'))
  .join('\n');
const normalizedSql = allSql.toLowerCase().replace(/\s+/g, ' ');

function latestFunctionDefinition(name: string): string {
  const createPattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+(?:public|private)\\.${name}\\s*\\(`,
    'ig',
  );
  let latest = '';

  for (const entry of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, entry), 'utf8');
    const matches = [...sql.matchAll(createPattern)];
    const match = matches.at(-1);
    if (!match || match.index === undefined) continue;

    const start = match.index;
    const rest = sql.slice(start + match[0].length);
    const nextRelative = rest.search(
      /\ncreate\s+or\s+replace\s+function\s+/i,
    );
    latest = sql.slice(
      start,
      nextRelative >= 0 ? start + match[0].length + nextRelative : sql.length,
    );
  }

  if (!latest) throw new Error(`Function ${name} was not found in migrations`);
  return latest.toLowerCase().replace(/\s+/g, ' ');
}

const reconcileSql = latestFunctionDefinition(
  'visionfood_reconcile_admin_push_subscription',
);
const audienceSql = latestFunctionDefinition(
  'visionfood_admin_push_subscription_ids',
);

describe('OneSignal admin subscription registry lifecycle', () => {
  it('binds one durable browser instance to exactly one current subscription without collapsing multiple devices', () => {
    expect(normalizedSql).toContain('onesignal_admin_push_subscriptions');
    expect(normalizedSql).toMatch(/client_instance_id\s+uuid/i);
    expect(
      /unique\s*\([^)]*client_instance_id[^)]*\)/i.test(normalizedSql) ||
        /create\s+unique\s+index[^;]*client_instance_id/i.test(normalizedSql),
    ).toBe(true);
    expect(reconcileSql).toContain('visionfood_reconcile_admin_push_subscription');

    const registryDeletes =
      reconcileSql.match(
        /delete\s+from\s+private\.onesignal_admin_push_subscriptions\b[^;]*;/gi,
      ) ?? [];

    expect(
      registryDeletes.some((statement) =>
        /client_instance_id\s*=\s*cid/i.test(statement),
      ),
    ).toBe(true);
    expect(
      registryDeletes.some(
        (statement) =>
          /user_id\s*=\s*u/i.test(statement) &&
          !/client_instance_id\s*=\s*cid/i.test(statement),
      ),
    ).toBe(false);
  });

  it('keeps legacy rows without a browser instance out of the authoritative admin audience', () => {
    expect(audienceSql).toMatch(/client_instance_id\s+is\s+not\s+null/i);
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
      /syncOneSignalAdminSubscription[\s\S]*Notifications\.permission[\s\S]*PushSubscription\??\.optedIn[\s\S]*unregisterAdminPushClient/,
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
