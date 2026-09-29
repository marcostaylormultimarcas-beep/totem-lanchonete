import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');

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

const normalizeSql = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
const deliveryTriggerSql = normalizeSql(
  latestFunctionDefinition('visionfood_push_delivery_trigger'),
);

const canonicalDdd55Mobile = '5555987654321';

describe('OneSignal phone external_id contract', () => {
  it('canonicalizes equivalent Brazilian phone formats to the same frontend external_id', async () => {
    const { normalizeOneSignalPhone } = await import('@/lib/onesignal');

    const cases = [
      {
        expected: '5562987654321',
        variants: ['(62) 98765-4321', '+55 (62) 98765-4321'],
      },
      {
        expected: canonicalDdd55Mobile,
        variants: ['(55) 98765-4321', '+55 (55) 98765-4321'],
      },
      {
        expected: '555532223333',
        variants: ['(55) 3222-3333', '+55 (55) 3222-3333'],
      },
      {
        expected: canonicalDdd55Mobile,
        variants: ['0 (55) 98765-4321', '0 21 (55) 98765-4321', '00 55 55 98765-4321'],
      },
    ];

    for (const { expected, variants } of cases) {
      for (const value of variants) {
        expect(normalizeOneSignalPhone(value), value).toBe(expected);
      }
    }
  });

  it('keeps the delivery trigger backend canonicalization aligned with the frontend contract', () => {
    expect(deliveryTriggerSql).toContain(
      "if left(phone,4)='0055' and length(phone) in (14,15) then",
    );
    expect(deliveryTriggerSql).toContain(
      "if left(phone,1)='0' and length(phone) in (11,12) then",
    );
    expect(deliveryTriggerSql).toContain(
      "if left(phone,1)='0' and length(phone) in (13,14) then",
    );
    expect(deliveryTriggerSql).toContain(
      "if length(phone) in (10,11) then phone:='55'||phone; end if;",
    );
    expect(deliveryTriggerSql).not.toContain("and left(phone,2)<>'55'");
  });
});
