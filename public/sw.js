// VisionFood Service Worker — Network-First (anti cache congelado)
// Estratégia: sempre tenta rede primeiro. Cache só é usado como fallback offline.
// Nunca cacheia chamadas ao Supabase, edge functions ou rotas internas.

const VERSION = 'vf-sw-v3';
const RUNTIME_CACHE = `${VERSION}-runtime`;
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

const BYPASS_HOSTS = ['supabase.co', 'supabase.in', 'functions.supabase.co'];
const BYPASS_PATHS = ['/~oauth', '/auth', '/functions/'];

function shouldBypass(url) {
  if (BYPASS_HOSTS.some((h) => url.hostname.includes(h))) return true;
  if (BYPASS_PATHS.some((p) => url.pathname.startsWith(p))) return true;
  return false;
}

async function networkFirstWithTimeout(request, timeoutMs) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const network = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    if (network && network.ok && request.method === 'GET') {
      cache.put(request, network.clone()).catch(() => {});
    }
    return network;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (shouldBypass(url)) return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirstWithTimeout(req, NAV_TIMEOUT_MS));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
