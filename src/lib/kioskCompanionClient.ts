const COMPANION_BASE_URL = 'http://127.0.0.1:43129';

let localSession: { token: string; expiresAt: number } | null = null;

export interface CompanionOfflineOrderDraft {
  organization_id: string;
  payment_method: 'cash';
  payment_status?: 'pending';
  items: unknown[];
  [key: string]: unknown;
}

interface CompanionResponse {
  ok?: boolean;
  reason?: string;
  [key: string]: unknown;
}

async function acquireLocalSession() {
  const response = await fetch(`${COMPANION_BASE_URL}/v1/session`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
  });
  const data = await response.json().catch(() => ({})) as CompanionResponse;
  if (!response.ok || !data?.ok || typeof data.local_session !== 'string') {
    throw new Error(String(data?.reason || 'companion_session_unavailable'));
  }

  const expiresAt = typeof data.expires_at === 'string'
    ? new Date(data.expires_at).getTime()
    : Date.now() + 5 * 60 * 1000;

  localSession = {
    token: data.local_session,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 5 * 60 * 1000,
  };
  return localSession.token;
}

async function getLocalSession() {
  if (localSession && localSession.expiresAt - Date.now() > 5_000) return localSession.token;
  return acquireLocalSession();
}

async function companionFetch(path: string, init: RequestInit = {}, allowRetry = true) {
  const token = await getLocalSession();
  const headers = new Headers(init.headers);
  headers.set('x-visionfood-local-session', token);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(`${COMPANION_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
    credentials: 'omit',
  });

  if (response.status === 401 && allowRetry) {
    localSession = null;
    return companionFetch(path, init, false);
  }

  const data = await response.json().catch(() => ({})) as CompanionResponse;
  if (!response.ok || data?.ok === false) {
    throw new Error(String(data?.reason || `companion_http_${response.status}`));
  }
  return data;
}

export async function getKioskCompanionStatus() {
  return companionFetch('/v1/status', { method: 'GET' });
}

export async function enrollKioskCompanion(enrollmentToken: string) {
  return companionFetch('/v1/enroll', {
    method: 'POST',
    body: JSON.stringify({ enrollment_token: enrollmentToken }),
  });
}

export async function enqueueOfflineOrderOnCompanion(draft: CompanionOfflineOrderDraft) {
  return companionFetch('/v1/orders', {
    method: 'POST',
    body: JSON.stringify(draft),
  });
}

export async function getKioskCompanionQueue() {
  return companionFetch('/v1/queue', { method: 'GET' });
}

export async function syncKioskCompanionQueueOnce() {
  return companionFetch('/v1/sync', { method: 'POST' });
}

export function clearKioskCompanionLocalSession() {
  localSession = null;
}
