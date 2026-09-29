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

  it('uses the 24-hour cooldown only after delivery was confirmed', () => {
    expect(sql).toMatch(
      /last_confirmed_at[\s\S]*interval\s*'24\s+hours'/i,
    );
    expect(sql).toMatch(
      /'delivered'\s*,\s*true[\s\S]*'deduplicated'\s*,\s*true/i,
    );
  });

  it('does not poison the cooldown when OneSignal was not actually queued', () => {
    expect(sql).toMatch(
      /if\s+request_id\s+is\s+null[\s\S]*return[\s\S]*end\s+if;[\s\S]*insert\s+into\s+private\.onesignal_predictive_push_dedupe/i,
    );
  });

  it('does not treat pg_net enqueue as delivery success', () => {
    expect(sql).toMatch(
      /visionfood_push_predictive_stock[\s\S]*net\._http_response[\s\S]*status_code/i,
    );
    expect(sql).toMatch(
      /status_code\s*>=\s*200[\s\S]*status_code\s*<\s*300/i,
    );
    expect(sql).toMatch(
      /timed_out[\s\S]*error_msg/i,
    );
  });

  it('releases a predictive cooldown after an asynchronous HTTP failure', () => {
    expect(sql).toMatch(
      /net\._http_response[\s\S]*(status_code\s*>=\s*400|timed_out|error_msg)[\s\S]*delete\s+from\s+private\.onesignal_predictive_push_dedupe/i,
    );
  });

  it('keeps an unconfirmed request pending only for a short grace window', () => {
    expect(sql).toMatch(
      /net\.http_request_queue[\s\S]*interval\s*'15\s+seconds'/i,
    );
    expect(sql).toContain('visionfood_predictive_push_result');
  });

  it('keeps the result RPC tenant-scoped and non-public', () => {
    expect(sql).toMatch(
      /visionfood_predictive_push_result[\s\S]*usuario_dono_org\(_org,u\)/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.visionfood_predictive_push_result\(uuid,bigint\)[\s\S]*from\s+public,anon/i,
    );
  });
});
