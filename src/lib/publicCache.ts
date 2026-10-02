export interface PublicCacheEnvelope<T> {
  savedAt: string;
  data: T;
}

const NETWORK_FALLBACK_TIMEOUT_MS = 2500;

export function readPublicCache<T>(key: string): PublicCacheEnvelope<T> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublicCacheEnvelope<T>;
    if (!parsed || typeof parsed.savedAt !== 'string' || parsed.data == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePublicCache<T>(key: string, data: T): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify({
      savedAt: new Date().toISOString(),
      data,
    } satisfies PublicCacheEnvelope<T>));
  } catch {
    // Public snapshots are an offline optimization; online operation remains authoritative.
  }
}

function knownOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function withFallbackTimeout<T>(loader: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loader(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('public_cache_network_timeout')), NETWORK_FALLBACK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadPublicDataWithFallback<T>(
  cacheKey: string,
  loader: () => Promise<T>,
  isUsable: (value: T) => boolean = (value) => value != null,
): Promise<T> {
  const cached = readPublicCache<T>(cacheKey);
  if (cached && knownOffline()) return cached.data;

  try {
    const fresh = await withFallbackTimeout(loader);
    if (!isUsable(fresh)) throw new Error('public_cache_fresh_payload_invalid');
    writePublicCache(cacheKey, fresh);
    return fresh;
  } catch (error) {
    if (cached) return cached.data;
    throw error;
  }
}
