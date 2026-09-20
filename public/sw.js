// VisionFood Service Worker — PHASE 295
// Cold-start contract: complete Vite app shell + reusable public media.
// Supabase API/Edge responses and browser/customer identity are never cached.

const VERSION = 'vf-sw-v5-phase295';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';
const MEDIA_CACHE = VERSION + '-media';
const NAV_TIMEOUT_MS = 3000;
const MANIFEST_URL = '/vite-manifest.json';
const REQUIRED_STATIC = [
  '/', '/index.html', MANIFEST_URL, '/manifest.json',
  '/favicon.ico', '/icon-192.png', '/icon-512.png', '/placeholder.svg',
];
const BYPASS_HOSTS = ['supabase.co', 'supabase.in', 'functions.supabase.co'];
const BYPASS_PATHS = ['/~oauth', '/auth', '/functions/'];
const SENSITIVE_QUERY_KEYS = ['token', 'access_token', 'signature', 'sig', 'expires', 'apikey', 'api_key'];

function hasSensitiveQuery(url) {
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.includes(key.toLowerCase())) return true;
  }
  return false;
}

function shouldBypass(url) {
  if (BYPASS_HOSTS.some((host) => url.hostname.includes(host))) return true;
  if (BYPASS_PATHS.some((path) => url.pathname.startsWith(path))) return true;
  return false;
}

function isSafePublicMediaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, self.location.origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password || hasSensitiveQuery(url)) return false;
    return true;
  } catch {
    return false;
  }
}

function collectManifestAssets(manifest) {
  const assets = new Set();
  for (const entry of Object.values(manifest || {})) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.file === 'string') assets.add('/' + entry.file.replace(/^\//, ''));
    for (const field of ['css', 'assets']) {
      if (!Array.isArray(entry[field])) continue;
      for (const file of entry[field]) {
        if (typeof file === 'string') assets.add('/' + file.replace(/^\//, ''));
      }
    }
  }
  return [...assets];
}

async function fetchRequired(request) {
  const response = await fetch(request, { cache: 'reload' });
  if (!response.ok) throw new Error('shell_asset_http_' + response.status + ':' + request.url);
  return response;
}

async function installShell() {
  const manifestRequest = new Request(MANIFEST_URL, { credentials: 'same-origin' });
  const manifestResponse = await fetchRequired(manifestRequest);
  const manifest = await manifestResponse.clone().json();
  const shellUrls = Array.from(new Set([...REQUIRED_STATIC, ...collectManifestAssets(manifest)]));
  const cache = await caches.open(SHELL_CACHE);

  for (const path of shellUrls) {
    const request = new Request(path, { credentials: 'same-origin' });
    const response = path === MANIFEST_URL ? manifestResponse.clone() : await fetchRequired(request);
    await cache.put(request, response);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await installShell();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith('vf-sw-') && !key.startsWith(VERSION)).map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

async function cachedShellNavigation(request) {
  const shell = await caches.open(SHELL_CACHE);
  return (await shell.match(request, { ignoreSearch: true }))
    || (await shell.match('/index.html'))
    || (await shell.match('/'));
}

async function networkFirstNavigation(request) {
  const runtime = await caches.open(RUNTIME_CACHE);
  try {
    const network = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS)),
    ]);
    if (network && network.ok) runtime.put(request, network.clone()).catch(() => {});
    return network;
  } catch {
    const cachedRuntime = await runtime.match(request, { ignoreSearch: true });
    if (cachedRuntime) return cachedRuntime;
    const shell = await cachedShellNavigation(request);
    if (shell) return shell;
    throw new Error('offline_shell_unavailable');
  }
}

async function cacheFirstAsset(request) {
  const shell = await caches.open(SHELL_CACHE);
  const cachedShell = await shell.match(request, { ignoreSearch: true });
  if (cachedShell) return cachedShell;

  const runtime = await caches.open(RUNTIME_CACHE);
  const cached = await runtime.match(request);
  if (cached) return cached;

  const network = await fetch(request);
  if (network.ok) runtime.put(request, network.clone()).catch(() => {});
  return network;
}

async function serveCachedPublicMedia(request) {
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    const shell = await caches.open(SHELL_CACHE);
    const shellAsset = await shell.match(request, { ignoreSearch: true });
    if (shellAsset) return shellAsset;
  }

  const media = await caches.open(MEDIA_CACHE);
  const cached = await media.match(request);
  if (cached) return cached;

  // Only URLs explicitly warmed from public RPC snapshots are persisted in MEDIA_CACHE.
  // Other images remain network-only so authenticated/private media is not retained here.
  return fetch(request);
}

async function precachePublicMedia(urls) {
  const cache = await caches.open(MEDIA_CACHE);
  for (const rawUrl of urls.slice(0, 200)) {
    if (!isSafePublicMediaUrl(rawUrl)) continue;
    try {
      const request = new Request(rawUrl, { mode: 'no-cors', credentials: 'omit' });
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') await cache.put(request, response);
    } catch {
      // Failed public-media warm-up never affects authoritative data.
    }
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.destination === 'image' && isSafePublicMediaUrl(url.href)) {
    event.respondWith(serveCachedPublicMedia(request));
    return;
  }

  if (shouldBypass(url)) return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.startsWith('/assets/') || REQUIRED_STATIC.includes(url.pathname)) {
    event.respondWith(cacheFirstAsset(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'VISIONFOOD_PRECACHE_PUBLIC_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil(precachePublicMedia(event.data.urls));
  }
});
