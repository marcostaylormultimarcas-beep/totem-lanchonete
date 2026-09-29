import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const oneSignalSource = readFileSync(join(root, 'src', 'lib', 'onesignal.ts'), 'utf8');

function latestPrivateFunctionDefinition(name: string): string {
  const needle = `create or replace function private.${name}(`;
  let latest: string | null = null;

  for (const file of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const lowerSql = sql.toLowerCase();
    const start = lowerSql.lastIndexOf(needle.toLowerCase());
    if (start < 0) continue;

    const nextFunction = lowerSql.indexOf(
      '\ncreate or replace function ',
      start + needle.length,
    );
    latest = sql.slice(start, nextFunction >= 0 ? nextFunction : sql.length);
  }

  if (!latest) throw new Error(`Function ${name} was not found in migrations`);
  return latest;
}

const audienceSql = latestPrivateFunctionDefinition(
  'visionfood_admin_push_subscription_ids',
);

describe('OneSignal admin subscription registry expiry', () => {
  it('keeps orphaned registrations out of the authoritative audience after a bounded lease', () => {
    expect(audienceSql).toMatch(
      /updated_at\s*>\s*pg_catalog\.clock_timestamp\(\)\s*-\s*interval\s*'30 days'/i,
    );
  });

  it('cleans expired registrations server-side instead of relying on a browser returning', () => {
    expect(audienceSql).toMatch(
      /delete\s+from\s+private\.onesignal_admin_push_subscriptions[\s\S]*updated_at\s*<=\s*pg_catalog\.clock_timestamp\(\)\s*-\s*interval\s*'30 days'/i,
    );
  });

  it('refreshes the server lease while an eligible admin browser stays alive', () => {
    expect(oneSignalSource).toContain('ADMIN_PUSH_REGISTRY_HEARTBEAT_MS');
    expect(oneSignalSource).toMatch(
      /watchOneSignalAdminSubscription[\s\S]*setInterval\([\s\S]*reconcile[\s\S]*ADMIN_PUSH_REGISTRY_HEARTBEAT_MS/,
    );
    expect(oneSignalSource).toMatch(
      /watchOneSignalAdminSubscription[\s\S]*clearInterval/,
    );
  });
});
