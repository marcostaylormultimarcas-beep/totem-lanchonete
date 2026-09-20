import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';

const QUEUE_VERSION = 1;
const DEVICE_VERSION = 1;
const DEFAULT_PORT = 43129;
const MAX_BODY_BYTES = 1024 * 1024;
const LOCAL_SESSION_TTL_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64_RE = /^[0-9a-f]{64}$/i;
const FORBIDDEN_AUTH_KEYS = new Set([
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'authorization',
  'auth_session',
  'supabase_session',
  'session_token',
  'jwt',
  'user_id',
  'auth_user_id',
  'customer_user_id',
]);

const nowIso = () => new Date().toISOString();
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomSecret = () => crypto.randomBytes(32).toString('hex');

function assertNoAuthMaterial(value, keyPath = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoAuthMaterial(entry, [...keyPath, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_AUTH_KEYS.has(normalized)) {
      throw new Error(`forbidden_auth_material:${[...keyPath, key].join('.')}`);
    }
    assertNoAuthMaterial(entry, [...keyPath, key]);
  }
}

function normalizeOfflineDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('invalid_order_draft');
  }

  assertNoAuthMaterial(input);

  const organizationId = input.organization_id;
  if (!isUuid(organizationId)) throw new Error('invalid_organization_id');

  const paymentMethod = String(input.payment_method || '');
  if (paymentMethod !== 'cash') {
    throw new Error('offline_payment_requires_cash');
  }
  if (String(input.payment_status || 'pending') === 'paid') {
    throw new Error('offline_payment_cannot_be_paid');
  }

  return {
    ...structuredClone(input),
    organization_id: organizationId,
    payment_method: 'cash',
    payment_status: 'pending',
    offline_payment_state: 'receivable',
    ownership: 'device_guest',
  };
}

async function ensurePrivateDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try { await fs.chmod(dir, 0o700); } catch {}
}

async function atomicWriteJson(filePath, value) {
  await ensurePrivateDirectory(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const handle = await fs.open(tmpPath, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmpPath, filePath);
  try { await fs.chmod(filePath, 0o600); } catch {}
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function readJsonOrNull(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export class DurableQueue {
  constructor({ rootDir, deviceId }) {
    if (!isUuid(deviceId)) throw new Error('invalid_device_id');
    this.rootDir = rootDir;
    this.deviceId = deviceId;
    this.filePath = path.join(rootDir, `queue-${deviceId}.json`);
    this.lock = Promise.resolve();
  }

  async init() {
    await ensurePrivateDirectory(this.rootDir);
    const existing = await readJsonOrNull(this.filePath);
    if (!existing) {
      await atomicWriteJson(this.filePath, { version: QUEUE_VERSION, next_sequence: 1, items: [] });
      return;
    }
    this.#validateState(existing);
  }

  #withLock(operation) {
    const run = this.lock.then(operation, operation);
    this.lock = run.catch(() => {});
    return run;
  }

  #validateState(state) {
    if (state?.version !== QUEUE_VERSION || !Array.isArray(state?.items) || !Number.isInteger(state?.next_sequence)) {
      throw new Error('invalid_queue_file');
    }
    for (const item of state.items) {
      if (item.device_id !== this.deviceId) throw new Error('queue_device_mismatch');
    }
  }

  async #readState() {
    const state = await readJson(this.filePath);
    this.#validateState(state);
    return state;
  }

  async enqueue(orderDraft) {
    return this.#withLock(async () => {
      const state = await this.#readState();
      const payload = normalizeOfflineDraft(orderDraft);
      const localOrderId = crypto.randomUUID();
      const clientRequestId = crypto.randomUUID();
      const timestamp = nowIso();
      const item = {
        version: 1,
        local_order_id: localOrderId,
        client_request_id: clientRequestId,
        device_id: this.deviceId,
        sequence: state.next_sequence,
        state: 'pending_local',
        attempts: 0,
        created_at: timestamp,
        updated_at: timestamp,
        last_attempt_at: null,
        last_error: null,
        authoritative_ack: null,
        payload,
      };
      state.next_sequence += 1;
      state.items.push(item);
      await atomicWriteJson(this.filePath, state);
      return structuredClone(item);
    });
  }

  async claimNext() {
    return this.#withLock(async () => {
      const state = await this.#readState();
      const item = state.items
        .filter((entry) => entry.state === 'pending_local')
        .sort((a, b) => a.sequence - b.sequence)[0];
      if (!item) return null;

      item.state = 'syncing';
      item.attempts += 1;
      item.last_attempt_at = nowIso();
      item.updated_at = item.last_attempt_at;
      item.last_error = null;
      await atomicWriteJson(this.filePath, state);
      return structuredClone(item);
    });
  }

  async recoverInterrupted() {
    return this.#withLock(async () => {
      const state = await this.#readState();
      let recovered = 0;
      const timestamp = nowIso();
      for (const item of state.items) {
        if (item.state !== 'syncing') continue;
        item.state = 'pending_local';
        item.updated_at = timestamp;
        item.last_error = 'sync_interrupted_before_authoritative_ack';
        recovered += 1;
      }
      if (recovered) await atomicWriteJson(this.filePath, state);
      return recovered;
    });
  }

  async markNeedsAttention(localOrderId, reason) {
    return this.#withLock(async () => {
      const state = await this.#readState();
      const item = state.items.find((entry) => entry.local_order_id === localOrderId);
      if (!item) throw new Error('local_order_not_found');
      if (item.state === 'synced') throw new Error('synced_order_is_immutable');
      item.state = 'needs_attention';
      item.last_error = String(reason || 'needs_attention').slice(0, 500);
      item.updated_at = nowIso();
      await atomicWriteJson(this.filePath, state);
      return structuredClone(item);
    });
  }

  async ackSynced(localOrderId, ack) {
    return this.#withLock(async () => {
      const state = await this.#readState();
      const item = state.items.find((entry) => entry.local_order_id === localOrderId);
      if (!item) throw new Error('local_order_not_found');
      if (item.state !== 'syncing') throw new Error('order_not_syncing');
      if (!ack || ack.client_request_id !== item.client_request_id) throw new Error('ack_client_request_mismatch');
      if (ack.device_id !== this.deviceId) throw new Error('ack_device_mismatch');
      if (!isUuid(ack.order_id)) throw new Error('ack_order_id_invalid');

      item.state = 'synced';
      item.authoritative_ack = {
        order_id: ack.order_id,
        client_request_id: ack.client_request_id,
        device_id: ack.device_id,
        acknowledged_at: nowIso(),
      };
      item.last_error = null;
      item.updated_at = item.authoritative_ack.acknowledged_at;
      await atomicWriteJson(this.filePath, state);
      return structuredClone(item);
    });
  }

  async snapshot() {
    return this.#withLock(async () => structuredClone(await this.#readState()));
  }

  async summary() {
    const state = await this.snapshot();
    const counts = { pending_local: 0, syncing: 0, synced: 0, needs_attention: 0 };
    for (const item of state.items) {
      if (Object.hasOwn(counts, item.state)) counts[item.state] += 1;
    }
    return {
      device_id: this.deviceId,
      total: state.items.length,
      counts,
      items: state.items
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map(({ local_order_id, client_request_id, device_id, sequence, state: itemState, attempts, created_at, updated_at, last_error, authoritative_ack }) => ({
          local_order_id,
          client_request_id,
          device_id,
          sequence,
          state: itemState,
          attempts,
          created_at,
          updated_at,
          last_error,
          authoritative_ack,
        })),
    };
  }
}

export function validateAllowedOrigin(rawOrigin) {
  const parsed = new URL(rawOrigin);
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('allowed_origin_must_be_https_or_loopback');
  }
  return parsed.origin;
}

function validateSupabaseUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:') throw new Error('supabase_url_must_use_https');
  return parsed.origin;
}

async function postRpc({ supabaseUrl, publishableKey, name, body }) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`rpc_${name}_http_${response.status}`);
  }
  return data;
}

export async function startCompanion(options = {}) {
  const rootDir = options.rootDir || process.env.VISIONFOOD_COMPANION_DIR || path.join(os.homedir(), '.visionfood-companion');
  const allowedOrigin = validateAllowedOrigin(options.allowedOrigin || process.env.VISIONFOOD_APP_ORIGIN || '');
  const supabaseUrl = validateSupabaseUrl(options.supabaseUrl || process.env.VISIONFOOD_SUPABASE_URL || '');
  const publishableKey = options.publishableKey || process.env.VISIONFOOD_SUPABASE_PUBLISHABLE_KEY || '';
  const port = Number(options.port || process.env.VISIONFOOD_COMPANION_PORT || DEFAULT_PORT);
  if (!publishableKey) throw new Error('VISIONFOOD_SUPABASE_PUBLISHABLE_KEY_required');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_companion_port');

  await ensurePrivateDirectory(rootDir);
  const devicePath = path.join(rootDir, 'device.json');
  const pendingEnrollmentPath = path.join(rootDir, 'pending-enrollment.json');
  const localSessions = new Map();
  let queueCache = null;

  const loadDevice = () => readJsonOrNull(devicePath);

  const saveDevice = async ({ deviceId, organizationId, credential, enrolledAt }) => {
    if (!isUuid(deviceId) || !isUuid(organizationId) || !HEX_64_RE.test(credential)) {
      throw new Error('invalid_device_config');
    }
    await atomicWriteJson(devicePath, {
      version: DEVICE_VERSION,
      device_id: deviceId,
      organization_id: organizationId,
      credential,
      enrolled_at: enrolledAt || nowIso(),
      updated_at: nowIso(),
    });
    queueCache = null;
  };

  const getQueue = async () => {
    const device = await loadDevice();
    if (!device || device.version !== DEVICE_VERSION || !isUuid(device.device_id) || !HEX_64_RE.test(device.credential || '')) {
      throw new Error('device_not_enrolled');
    }
    if (!queueCache || queueCache.deviceId !== device.device_id) {
      queueCache = new DurableQueue({ rootDir, deviceId: device.device_id });
      await queueCache.init();
      await queueCache.recoverInterrupted();
    }
    return queueCache;
  };

  const finalizePendingEnrollment = async (pending) => {
    const result = await postRpc({
      supabaseUrl,
      publishableKey,
      name: 'visionfood_claim_kiosk_enrollment',
      body: {
        _enrollment_token: pending.enrollment_token,
        _device_id: pending.device_id,
        _credential_hash: pending.credential_hash,
      },
    });
    if (!result?.ok) throw new Error(`enrollment_rejected:${String(result?.reason || 'unknown')}`);

    await saveDevice({
      deviceId: result.device_id,
      organizationId: result.organization_id,
      credential: pending.credential,
      enrolledAt: pending.started_at,
    });
    await fs.rm(pendingEnrollmentPath, { force: true });
    return {
      ok: true,
      device_id: result.device_id,
      organization_id: result.organization_id,
      credential_version: result.credential_version || null,
      idempotent: Boolean(result.idempotent),
    };
  };

  const recoverPendingEnrollment = async () => {
    const pending = await readJsonOrNull(pendingEnrollmentPath);
    if (!pending) return null;
    if (!HEX_64_RE.test(pending.enrollment_token || '') || !HEX_64_RE.test(pending.credential || '') || !isUuid(pending.device_id)) {
      throw new Error('invalid_pending_enrollment_file');
    }
    return finalizePendingEnrollment(pending);
  };

  const enroll = async (enrollmentToken) => {
    if (!HEX_64_RE.test(enrollmentToken || '')) throw new Error('invalid_enrollment_token');
    const current = await loadDevice();
    const deviceId = current?.device_id && isUuid(current.device_id) ? current.device_id : crypto.randomUUID();
    const credential = randomSecret();
    const pending = {
      version: 1,
      enrollment_token: enrollmentToken,
      device_id: deviceId,
      credential,
      credential_hash: sha256Hex(credential),
      started_at: nowIso(),
    };
    await atomicWriteJson(pendingEnrollmentPath, pending);
    return finalizePendingEnrollment(pending);
  };

  try {
    await recoverPendingEnrollment();
  } catch (error) {
    console.error(nowIso(), 'pending enrollment recovery failed:', error.message);
  }

  const corsHeaders = (origin) => ({
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-visionfood-local-session',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    vary: 'Origin',
  });

  const send = (res, origin, status, body) => {
    res.writeHead(status, corsHeaders(origin));
    res.end(JSON.stringify(body));
  };

  const parseBody = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });

  const validSession = (req) => {
    const token = req.headers['x-visionfood-local-session'];
    if (typeof token !== 'string') return false;
    const expiresAt = localSessions.get(token);
    if (!expiresAt || expiresAt <= Date.now()) {
      localSessions.delete(token);
      return false;
    }
    return true;
  };

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    if (origin !== allowedOrigin) {
      res.writeHead(403, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, reason: 'origin_not_allowed' }));
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }

    try {
      const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);

      if (req.method === 'POST' && requestUrl.pathname === '/v1/session') {
        const token = randomSecret();
        const expiresAt = Date.now() + LOCAL_SESSION_TTL_MS;
        localSessions.set(token, expiresAt);
        send(res, origin, 200, { ok: true, local_session: token, expires_at: new Date(expiresAt).toISOString() });
        return;
      }

      if (!validSession(req)) {
        send(res, origin, 401, { ok: false, reason: 'local_session_required' });
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/v1/status') {
        const device = await loadDevice();
        let queue = null;
        if (device?.device_id) {
          try { queue = await (await getQueue()).summary(); } catch (error) { queue = { error: error.message }; }
        }
        send(res, origin, 200, {
          ok: true,
          enrolled: Boolean(device?.device_id),
          device_id: device?.device_id || null,
          organization_id: device?.organization_id || null,
          queue,
        });
        return;
      }

      if (req.method === 'POST' && requestUrl.pathname === '/v1/enroll') {
        const body = await parseBody(req);
        const result = await enroll(String(body?.enrollment_token || ''));
        send(res, origin, 200, result);
        return;
      }

      if (req.method === 'POST' && requestUrl.pathname === '/v1/orders') {
        const body = await parseBody(req);
        const queue = await getQueue();
        const item = await queue.enqueue(body);
        send(res, origin, 201, {
          ok: true,
          local_order_id: item.local_order_id,
          client_request_id: item.client_request_id,
          state: item.state,
          sequence: item.sequence,
        });
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/v1/queue') {
        const queue = await getQueue();
        send(res, origin, 200, { ok: true, ...(await queue.summary()) });
        return;
      }

      send(res, origin, 404, { ok: false, reason: 'not_found' });
    } catch (error) {
      const message = String(error?.message || error);
      const safeReason = message.startsWith('forbidden_auth_material:')
        ? 'order_contains_auth_material'
        : message;
      send(res, origin, 400, { ok: false, reason: safeReason });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  let stopped = false;
  const heartbeat = async () => {
    if (stopped) return;
    try {
      const device = await loadDevice();
      if (device?.device_id && HEX_64_RE.test(device.credential || '')) {
        const result = await postRpc({
          supabaseUrl,
          publishableKey,
          name: 'visionfood_kiosk_device_heartbeat',
          body: { _device_id: device.device_id, _credential: device.credential },
        });
        if (!result?.ok) console.warn(nowIso(), 'heartbeat rejected');
      }
    } catch (error) {
      console.warn(nowIso(), 'heartbeat unavailable:', error.message);
    } finally {
      if (!stopped) setTimeout(heartbeat, HEARTBEAT_MS).unref();
    }
  };
  setTimeout(heartbeat, 1000).unref();

  console.log(nowIso(), `VisionFood companion listening on 127.0.0.1:${port} for ${allowedOrigin}`);

  return {
    port,
    allowedOrigin,
    rootDir,
    async close() {
      stopped = true;
      localSessions.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath && import.meta.url === invokedPath) {
  startCompanion().catch((error) => {
    console.error(nowIso(), 'VisionFood companion failed to start:', error.message);
    process.exitCode = 1;
  });
}
