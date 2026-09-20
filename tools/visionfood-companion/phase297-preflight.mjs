import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const STATES = new Set(['pending_local', 'syncing', 'synced', 'needs_attention']);
const FORBIDDEN = new Set([
  'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
  'authorization', 'auth_session', 'supabase_session', 'session_token',
  'jwt', 'user_id', 'auth_user_id', 'customer_user_id',
]);

function args(argv) {
  const out = {
    origin: process.env.VISIONFOOD_APP_ORIGIN || '',
    rootDir: process.env.VISIONFOOD_COMPANION_DIR || path.join(os.homedir(), '.visionfood-companion'),
  };
  for (const value of argv) {
    if (value.startsWith('--origin=')) out.origin = value.slice('--origin='.length);
    if (value.startsWith('--root-dir=')) out.rootDir = value.slice('--root-dir='.length);
  }
  return out;
}

function findAuth(value, pathParts = []) {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => found.push(...findAuth(entry, [...pathParts, String(index)])));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN.has(key.toLowerCase())) found.push([...pathParts, key].join('.'));
    found.push(...findAuth(entry, [...pathParts, key]));
  }
  return found;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

const options = args(process.argv.slice(2));
const checks = [];
let device = null;
let queueState = null;

function record(name, status, detail = '') {
  checks.push({ name, status, detail });
  console.log(status + ' - ' + name + (detail ? ' - ' + detail : ''));
}

const devicePath = path.join(options.rootDir, 'device.json');
try {
  device = await readJson(devicePath);
  const valid = device?.version === 1
    && UUID_RE.test(device?.device_id || '')
    && UUID_RE.test(device?.organization_id || '')
    && HEX64_RE.test(device?.credential || '');
  record(
    'device.json válido e enrollment local presente',
    valid ? 'PASSOU' : 'FALHOU',
    valid ? 'device_id=' + device.device_id + '; organization_id=' + device.organization_id : 'arquivo inválido',
  );
} catch (error) {
  record('device.json válido e enrollment local presente', 'FALHOU', String(error?.message || error));
}

if (device?.device_id && UUID_RE.test(device.device_id)) {
  const queuePath = path.join(options.rootDir, 'queue-' + device.device_id + '.json');
  try {
    queueState = await readJson(queuePath);
    const items = Array.isArray(queueState?.items) ? queueState.items : [];
    const localIds = new Set();
    const requestIds = new Set();
    const sequences = new Set();
    const issues = [];

    if (queueState?.version !== 1 || !Number.isInteger(queueState?.next_sequence)) issues.push('queue_header_invalid');

    for (const item of items) {
      if (!UUID_RE.test(item?.local_order_id || '')) issues.push('invalid_local_order_id');
      if (!UUID_RE.test(item?.client_request_id || '')) issues.push('invalid_client_request_id');
      if (item?.device_id !== device.device_id) issues.push('device_mismatch');
      if (!STATES.has(item?.state)) issues.push('invalid_state');
      if (!Number.isInteger(item?.sequence) || item.sequence < 1) issues.push('invalid_sequence');
      if (localIds.has(item?.local_order_id)) issues.push('duplicate_local_order_id');
      if (requestIds.has(item?.client_request_id)) issues.push('duplicate_client_request_id');
      if (sequences.has(item?.sequence)) issues.push('duplicate_sequence');
      localIds.add(item?.local_order_id);
      requestIds.add(item?.client_request_id);
      sequences.add(item?.sequence);

      if (item?.payload?.organization_id !== device.organization_id) issues.push('payload_org_mismatch');
      if (item?.payload?.payment_method !== 'cash') issues.push('offline_payment_not_cash');
      if ((item?.payload?.payment_status || 'pending') !== 'pending') issues.push('offline_payment_not_pending');
      if (item?.payload?.ownership !== 'device_guest') issues.push('ownership_not_device_guest');
      const auth = findAuth(item?.payload);
      if (auth.length) issues.push('forbidden_auth_material:' + auth.join(','));
    }

    record(
      'fila persistente íntegra, IDs únicos e contrato device-owned',
      issues.length ? 'FALHOU' : 'PASSOU',
      issues.length ? [...new Set(issues)].join('; ') : 'items=' + items.length,
    );

    if (process.platform !== 'win32') {
      const stats = await Promise.all([fs.stat(options.rootDir), fs.stat(devicePath), fs.stat(queuePath)]);
      const privateModes = stats.every((stat) => (stat.mode & 0o077) === 0);
      record(
        'arquivos locais sem permissão para group/other',
        privateModes ? 'PASSOU' : 'FALHOU',
        privateModes ? 'permissões privadas' : 'permissões excessivas',
      );
    } else {
      record(
        'arquivos locais sem permissão para group/other',
        'NÃO EXECUTADO',
        'checagem POSIX não se aplica diretamente ao Windows',
      );
    }
  } catch (error) {
    record('fila persistente íntegra, IDs únicos e contrato device-owned', 'FALHOU', String(error?.message || error));
  }
} else {
  record('fila persistente íntegra, IDs únicos e contrato device-owned', 'BLOQUEADO', 'device_id local ausente/inválido');
}

if (options.origin) {
  try {
    const sessionResponse = await fetch('http://127.0.0.1:43129/v1/session', {
      method: 'POST',
      headers: { Origin: options.origin },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    const session = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok || !session?.ok || typeof session?.local_session !== 'string') {
      throw new Error(String(session?.reason || ('session_http_' + sessionResponse.status)));
    }

    const statusResponse = await fetch('http://127.0.0.1:43129/v1/status', {
      method: 'GET',
      headers: {
        Origin: options.origin,
        'x-visionfood-local-session': session.local_session,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    const status = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok || !status?.ok) {
      throw new Error(String(status?.reason || ('status_http_' + statusResponse.status)));
    }

    const coherent = Boolean(
      device
      && status.enrolled === true
      && status.device_id === device.device_id
      && status.organization_id === device.organization_id
      && !status.queue?.error
    );
    record(
      'companion acessível em 127.0.0.1:43129 e enrollment coerente',
      coherent ? 'PASSOU' : 'FALHOU',
      coherent ? 'device_id=' + status.device_id + '; organization_id=' + status.organization_id : 'status diverge do disco',
    );
  } catch (error) {
    record('companion acessível em 127.0.0.1:43129 e enrollment coerente', 'FALHOU', String(error?.message || error));
  }
} else {
  record(
    'companion acessível em 127.0.0.1:43129 e enrollment coerente',
    'NÃO EXECUTADO',
    'informe --origin=https://ORIGEM-DO-TOTEM ou VISIONFOOD_APP_ORIGIN',
  );
}

const counts = { pending_local: 0, syncing: 0, synced: 0, needs_attention: 0 };
for (const item of queueState?.items || []) {
  if (Object.hasOwn(counts, item.state)) counts[item.state] += 1;
}

const report = {
  phase: 297,
  generated_at: new Date().toISOString(),
  device_id: device?.device_id || null,
  organization_id: device?.organization_id || null,
  queue_counts: counts,
  checks,
};

console.log(JSON.stringify(report, null, 2));
if (checks.some((check) => check.status === 'FALHOU')) process.exitCode = 1;
