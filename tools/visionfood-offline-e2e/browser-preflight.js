(() => {
  const REQUIRED_STATIC = ['/', '/index.html', '/vite-manifest.json', '/manifest.json'];
  const SNAPSHOTS = [
    ['organization', 'visionfood_public_organization_v1:id:'],
    ['storefront', 'visionfood_public_storefront_v1:'],
    ['catalog', 'visionfood_public_catalog_v1:'],
    ['theme', 'visionfood_public_theme_v1:'],
    ['payment', 'visionfood_checkout_payment_config_v1:'],
    ['delivery_areas', 'visionfood_public_delivery_areas_v1:'],
  ];

  function parseEnvelope(raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.savedAt === 'string' && parsed.data != null ? parsed : null;
    } catch {
      return null;
    }
  }

  function manifestAssets(manifest) {
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

  function browserAuthMaterial() {
    const findings = [];
    for (const [label, storage] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key) continue;
        if (/^sb-.*-auth-token(?:-|$)/i.test(key)) findings.push(label + ':' + key);
        const raw = storage.getItem(key) || '';
        if (/"(?:access_token|refresh_token|provider_token|provider_refresh_token|supabase_session|auth_session)"\s*:/i.test(raw)) {
          findings.push(label + ':' + key + ':token_field');
        }
      }
    }
    if (/(?:^|;\s*)sb-[^=]*auth-token[^=]*=/i.test(document.cookie)) findings.push('cookie:supabase_auth_token');
    return findings;
  }

  async function companionStatus() {
    const sessionResponse = await fetch('http://127.0.0.1:43129/v1/session', {
      method: 'POST', cache: 'no-store', credentials: 'omit',
    });
    const session = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok || !session?.ok || typeof session.local_session !== 'string') {
      throw new Error(String(session?.reason || ('session_http_' + sessionResponse.status)));
    }
    const statusResponse = await fetch('http://127.0.0.1:43129/v1/status', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'x-visionfood-local-session': session.local_session },
    });
    const status = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok || !status?.ok) {
      throw new Error(String(status?.reason || ('status_http_' + statusResponse.status)));
    }
    return status;
  }

  async function authorityReachable() {
    try {
      await fetch('https://udhcnpauymevkylldkir.supabase.co/rest/v1/', {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(2500),
      });
      return true;
    } catch {
      return false;
    }
  }

  async function run({ expectOffline = false } = {}) {
    const checks = [];
    const record = (name, status, detail = '') => checks.push({ name, status, detail });

    const registration = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration('/')
      : null;
    record('Service Worker instalado/ativo', registration?.active ? 'PASSOU' : 'FALHOU',
      registration?.active?.scriptURL || 'sem registration.active');
    record('Service Worker controlando a página', navigator.serviceWorker?.controller ? 'PASSOU' : 'FALHOU',
      navigator.serviceWorker?.controller?.scriptURL || 'sem controller');

    const names = 'caches' in window ? await caches.keys() : [];
    const shellName = names.filter((name) => /^vf-sw-.*-shell$/.test(name)).sort().at(-1) || '';
    if (!shellName) {
      record('app shell completo no Cache Storage', 'FALHOU', 'cache shell não encontrado');
    } else {
      const shell = await caches.open(shellName);
      const missing = [];
      for (const pathname of REQUIRED_STATIC) {
        if (!(await shell.match(pathname, { ignoreSearch: true }))) missing.push(pathname);
      }
      const manifestResponse = await shell.match('/vite-manifest.json', { ignoreSearch: true });
      if (manifestResponse) {
        try {
          const manifest = await manifestResponse.clone().json();
          for (const pathname of manifestAssets(manifest)) {
            if (!(await shell.match(pathname, { ignoreSearch: true }))) missing.push(pathname);
          }
        } catch {
          missing.push('vite-manifest.json:invalid_json');
        }
      }
      record(
        'app shell completo no Cache Storage',
        missing.length ? 'FALHOU' : 'PASSOU',
        missing.length ? 'faltando=' + [...new Set(missing)].join(',') : shellName,
      );
    }

    let companion = null;
    try {
      companion = await companionStatus();
      const valid = companion.enrolled === true
        && typeof companion.device_id === 'string'
        && typeof companion.organization_id === 'string'
        && !companion.queue?.error;
      record(
        'companion local acessível e enrollment válido',
        valid ? 'PASSOU' : 'FALHOU',
        valid ? 'device_id=' + companion.device_id + '; organization_id=' + companion.organization_id : 'status inválido',
      );
    } catch (error) {
      record('companion local acessível e enrollment válido', 'FALHOU', String(error?.message || error));
    }

    const orgId = companion?.organization_id || '';
    if (orgId) {
      for (const [label, prefix] of SNAPSHOTS) {
        const key = prefix + orgId;
        const envelope = parseEnvelope(localStorage.getItem(key));
        let usable = Boolean(envelope);
        let detail = envelope ? 'savedAt=' + envelope.savedAt : 'ausente:' + key;
        if (label === 'catalog' && envelope) {
          usable = Array.isArray(envelope.data) && envelope.data.length > 0;
          detail += '; items=' + (Array.isArray(envelope.data) ? envelope.data.length : 'invalid');
        }
        record('snapshot público ' + label, usable ? 'PASSOU' : 'FALHOU', detail);
      }
    } else {
      record('snapshots públicos necessários', 'BLOQUEADO', 'organization_id do companion indisponível');
    }

    const auth = browserAuthMaterial();
    record(
      'nenhuma sessão/access token/refresh token de cliente persistido no navegador',
      auth.length ? 'FALHOU' : 'PASSOU',
      auth.length ? auth.join('; ') : 'nenhum material de auth encontrado',
    );

    const reachable = await authorityReachable();
    if (expectOffline) {
      record(
        'autoridade Supabase realmente indisponível durante etapa offline',
        reachable ? 'FALHOU' : 'PASSOU',
        'navigator.onLine=' + navigator.onLine,
      );
    } else {
      record(
        'autoridade Supabase alcançável durante pre-sync online',
        reachable ? 'PASSOU' : 'FALHOU',
        'navigator.onLine=' + navigator.onLine,
      );
    }

    const report = {
      phase: 297,
      generated_at: new Date().toISOString(),
      url: location.href,
      expect_offline: Boolean(expectOffline),
      navigator_online: navigator.onLine,
      service_worker_controller: navigator.serviceWorker?.controller?.scriptURL || null,
      shell_cache: shellName || null,
      device_id: companion?.device_id || null,
      organization_id: companion?.organization_id || null,
      queue: companion?.queue || null,
      checks,
    };

    console.table(checks);
    console.log('VISIONFOOD_PHASE297_REPORT', report);
    window.__VISIONFOOD_PHASE297_LAST_REPORT__ = report;
    return report;
  }

  window.visionFoodPhase297Preflight = run;
  console.info('PHASE 297 carregada. Execute visionFoodPhase297Preflight com expectOffline false/true.');
})();
