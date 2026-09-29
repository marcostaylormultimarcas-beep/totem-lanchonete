import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const adminSource = readFileSync(join(root, 'src', 'pages', 'Admin.tsx'), 'utf8');
const oneSignalSource = readFileSync(join(root, 'src', 'lib', 'onesignal.ts'), 'utf8');

function latestFunctionDefinition(name: string): string {
  const needle = `create or replace function public.${name}(`;
  let latest: string | null = null;

  for (const file of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const lowerSql = sql.toLowerCase();
    const start = lowerSql.lastIndexOf(needle.toLowerCase());
    if (start < 0) continue;

    const nextFunction = lowerSql.indexOf(
      '\ncreate or replace function public.',
      start + needle.length,
    );
    latest = sql.slice(start, nextFunction >= 0 ? nextFunction : sql.length);
  }

  if (!latest) throw new Error(`Function ${name} was not found in migrations`);
  return latest;
}

const allSql = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort()
  .map((entry) => readFileSync(join(migrationsDir, entry), 'utf8'))
  .join('\n');

const ruptureSql = latestFunctionDefinition('visionfood_push_rupture_trigger');
const predictiveSql = latestFunctionDefinition('visionfood_push_predictive_stock');

describe('OneSignal admin audience isolation contract', () => {
  it('registers browser push subscriptions through an authenticated organization-scoped backend contract', () => {
    expect(allSql).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+private\.onesignal_admin_push_subscriptions/i,
    );
    expect(allSql).toMatch(
      /visionfood_register_admin_push_subscription[\s\S]*auth\.uid\(\)[\s\S]*usuario_dono_org/i,
    );
    expect(allSql).toMatch(
      /visionfood_unregister_admin_push_subscription[\s\S]*auth\.uid\(\)/i,
    );
  });

  it('does not authorize rupture or predictive admin audiences from browser-writable tags', () => {
    for (const sql of [ruptureSql, predictiveSql]) {
      expect(sql).toContain('include_subscription_ids');
      expect(sql).not.toMatch(
        /'field'\s*,\s*'tag'[\s\S]*'key'\s*,\s*'tipo'[\s\S]*'value'\s*,\s*'admin'/i,
      );
    }
  });

  it('syncs the current OneSignal PushSubscription id only after authenticated admin context exists', () => {
    expect(oneSignalSource).toContain('syncOneSignalAdminSubscription');
    expect(oneSignalSource).toContain('PushSubscription.id');
    expect(oneSignalSource).toContain('visionfood_register_admin_push_subscription');
    expect(adminSource).toContain('syncOneSignalAdminSubscription(activeOrgId)');
  });

  it('unregisters the server-side admin subscription before detaching OneSignal identity on logout', () => {
    expect(oneSignalSource).toContain('visionfood_unregister_admin_push_subscription');
    expect(oneSignalSource).toMatch(
      /logoutOneSignalUser[\s\S]*visionfood_unregister_admin_push_subscription[\s\S]*OneSignal\.logout\(\)/,
    );
  });
});
