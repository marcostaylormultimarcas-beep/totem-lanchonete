import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const sql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
  .join('\n');

describe('predictive stock push persistent cooldown contract', () => {
  it('persists predictive push dedupe outside the browser lifecycle', () => {
    expect(sql).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+private\.onesignal_predictive_push_dedupe/i,
    );
    expect(sql).toMatch(
      /primary\s+key\s*\(\s*organization_id\s*,\s*ingredient_key\s*,\s*days_remaining\s*\)/i,
    );
  });

  it('serializes concurrent callers before checking the cooldown', () => {
    expect(sql).toMatch(
      /visionfood_push_predictive_stock[\s\S]*pg_advisory_xact_lock[\s\S]*onesignal_predictive_push_dedupe/i,
    );
  });

  it('suppresses the same organization ingredient and day bucket for 24 hours', () => {
    expect(sql).toMatch(
      /last_queued_at[\s\S]*interval\s*'24\s+hours'/i,
    );
    expect(sql).toMatch(
      /'deduplicated'\s*,\s*true/i,
    );
  });

  it('does not poison the cooldown when OneSignal was not actually queued', () => {
    expect(sql).toMatch(
      /if\s+request_id\s+is\s+null[\s\S]*return[\s\S]*end\s+if;[\s\S]*insert\s+into\s+private\.onesignal_predictive_push_dedupe/i,
    );
  });
});
