import { supabase } from '@/integrations/supabase/client';

type OneSignalTags = Record<string, string>;
type OneSignalPublicConfig = { appId: string };

let sdkPromise: Promise<any | null> | null = null;
let sdkPromiseAppId: string | null = null;
let sdkPromiseStale = false;
let initializedSdk: any | null = null;
let initializedAppId: string | null = null;
let identityQueue: Promise<void> = Promise.resolve();

function runSerializedIdentityTask<T>(task: () => Promise<T>): Promise<T> {
  const run = identityQueue.then(task, task);
  identityQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const normalizeDigits = (value: string) => (value || '').replace(/\D/g, '');

export function normalizeOneSignalPhone(value: string): string {
  let digits = normalizeDigits(value);
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }
  return digits;
}

async function readPublicConfig(): Promise<OneSignalPublicConfig | null> {
  const { data, error } = await supabase.rpc('onesignal_public_config' as any);
  const cfg: any = data;
  if (error || !cfg?.ok || !cfg?.enabled || !cfg?.app_id) return null;

  const appId = String(cfg.app_id).trim();
  return appId ? { appId } : null;
}

async function loadSdkScript(): Promise<void> {
  if (typeof window === 'undefined') return;
  if ((window as any).OneSignalDeferred) return;

  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('visionfood-onesignal-sdk') as HTMLScriptElement | null;
    if (existing) {
      if ((window as any).OneSignalDeferred) { resolve(); return; }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('onesignal_sdk_load_failed')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'visionfood-onesignal-sdk';
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('onesignal_sdk_load_failed'));
    document.head.appendChild(script);
  });
}

async function initializeSdk(appId: string): Promise<any | null> {
  await loadSdkScript();

  const w = window as any;
  w.OneSignalDeferred = w.OneSignalDeferred || [];

  return await new Promise<any | null>((resolve) => {
    let settled = false;
    const finish = (value: any | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(null), 10_000);

    w.OneSignalDeferred.push(async (OneSignal: any) => {
      if (settled) return;
      window.clearTimeout(timer);

      try {
        await OneSignal.init({
          appId,
          notifyButton: { enable: false },
          serviceWorkerPath: '/onesignal/OneSignalSDKWorker.js',
          serviceWorkerParam: { scope: '/onesignal/' },
        });
        finish(OneSignal);
      } catch (err) {
        console.warn('[OneSignal] Falha ao inicializar SDK:', err);
        finish(null);
      }
    });
  });
}

function warnAppIdChange(currentAppId: string, configuredAppId: string) {
  console.warn(
    '[OneSignal] App ID alterado durante a sessão; recarregue a página antes de usar o novo App ID.',
    { currentAppId, configuredAppId },
  );
}

async function getOneSignal(): Promise<any | null> {
  if (typeof window === 'undefined' || !window.isSecureContext) return null;

  const cfg = await readPublicConfig();
  if (!cfg) {
    if (sdkPromise) sdkPromiseStale = true;
    return null;
  }

  if (initializedSdk) {
    if (initializedAppId !== cfg.appId) {
      warnAppIdChange(initializedAppId || '', cfg.appId);
      return null;
    }
    return initializedSdk;
  }

  if (sdkPromise) {
    if (sdkPromiseAppId !== cfg.appId) {
      sdkPromiseStale = true;
      warnAppIdChange(sdkPromiseAppId || '', cfg.appId);
      return null;
    }
    return sdkPromise;
  }

  const appId = cfg.appId;
  sdkPromiseAppId = appId;
  sdkPromiseStale = false;

  const pending = initializeSdk(appId).catch((err) => {
    console.warn('[OneSignal] Inicialização indisponível:', err);
    return null;
  });
  sdkPromise = pending;

  const OneSignal = await pending;
  const stale = sdkPromiseStale;

  if (sdkPromise === pending) {
    sdkPromise = null;
    sdkPromiseAppId = null;
    sdkPromiseStale = false;
  }

  if (!OneSignal) return null;

  initializedSdk = OneSignal;
  initializedAppId = appId;

  if (stale) return null;
  return OneSignal;
}

async function applyOneSignalIdentity(
  OneSignal: any,
  externalId: string,
  tags: OneSignalTags,
): Promise<void> {
  await OneSignal.login(externalId);
  if (Object.keys(tags).length) {
    await OneSignal.User.addTags(tags);
  }
}

export async function identifyOneSignalUser(
  externalId: string,
  tags: OneSignalTags = {},
): Promise<boolean> {
  const id = externalId.trim();
  if (!id) return false;

  return runSerializedIdentityTask(async () => {
    const OneSignal = await getOneSignal();
    if (!OneSignal) return false;

    try {
      await applyOneSignalIdentity(OneSignal, id, tags);
      return true;
    } catch (err) {
      console.warn('[OneSignal] Falha ao identificar usuário:', err);
      return false;
    }
  });
}

export async function requestOneSignalPermission(
  externalId: string,
  tags: OneSignalTags = {},
): Promise<boolean> {
  const id = externalId.trim();
  if (!id) return false;

  return runSerializedIdentityTask(async () => {
    const OneSignal = await getOneSignal();
    if (!OneSignal) return false;

    try {
      await applyOneSignalIdentity(OneSignal, id, tags);

      let permissionGranted = Boolean(OneSignal.Notifications.permission);
      if (!permissionGranted) {
        permissionGranted = Boolean(
          await OneSignal.Notifications.requestPermission(),
        );
      }
      if (!permissionGranted) return false;

      if (!OneSignal.User.PushSubscription.optedIn) {
        await OneSignal.User.PushSubscription.optIn();
      }

      return Boolean(OneSignal.User.PushSubscription.optedIn);
    } catch (err) {
      console.warn('[OneSignal] Falha ao ativar notificações:', err);
      return false;
    }
  });
}

export async function logoutOneSignalUser(): Promise<boolean> {
  return runSerializedIdentityTask(async () => {
    const OneSignal = initializedSdk || await getOneSignal();
    if (!OneSignal) return false;

    try {
      await OneSignal.logout();
      return true;
    } catch (err) {
      console.warn('[OneSignal] Falha ao encerrar identidade do usuário:', err);
      return false;
    }
  });
}

/**
 * Alerta preditivo calculado no ADM. A API key nunca passa pelo navegador:
 * o RPC valida a organização e enfileira o envio no servidor.
 */
export async function triggerPredictiveStockAlert(
  organizationId: string,
  ingredienteNome: string,
  diasRestantes: number,
): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('visionfood_push_predictive_stock', {
      _org: organizationId,
      _ingredient_name: ingredienteNome,
      _days_remaining: Math.max(1, Math.ceil(diasRestantes)),
    });
    const result: any = data;
    if (error) {
      console.warn('[OneSignal] Falha ao enfileirar alerta preditivo:', error.message);
      return;
    }
    if (result?.ok === false) {
      console.warn('[OneSignal] Alerta preditivo não enfileirado:', result.reason);
    }
  } catch (err: any) {
    console.warn('[OneSignal] Erro no alerta preditivo:', err?.message || err);
  }
}
