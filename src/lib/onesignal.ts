import { supabase } from '@/integrations/supabase/client';

type OneSignalTags = Record<string, string>;

let sdkPromise: Promise<any | null> | null = null;

const normalizeDigits = (value: string) => (value || '').replace(/\D/g, '');

export function normalizeOneSignalPhone(value: string): string {
  let digits = normalizeDigits(value);
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }
  return digits;
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

async function getOneSignal(): Promise<any | null> {
  if (typeof window === 'undefined' || !window.isSecureContext) return null;
  if (sdkPromise) return sdkPromise;

  sdkPromise = (async () => {
    const { data, error } = await supabase.rpc('onesignal_public_config' as any);
    const cfg: any = data;
    if (error || !cfg?.ok || !cfg?.enabled || !cfg?.app_id) return null;

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
        try {
          await OneSignal.init({
            appId: cfg.app_id,
            notifyButton: { enable: false },
            serviceWorkerPath: '/onesignal/OneSignalSDKWorker.js',
            serviceWorkerParam: { scope: '/onesignal/' },
          });
          window.clearTimeout(timer);
          finish(OneSignal);
        } catch (err) {
          console.warn('[OneSignal] Falha ao inicializar SDK:', err);
          window.clearTimeout(timer);
          finish(null);
        }
      });
    });
  })().catch((err) => {
    console.warn('[OneSignal] Inicialização indisponível:', err);
    sdkPromise = null;
    return null;
  });

  return sdkPromise;
}

export async function identifyOneSignalUser(
  externalId: string,
  tags: OneSignalTags = {},
): Promise<boolean> {
  const id = externalId.trim();
  if (!id) return false;

  const OneSignal = await getOneSignal();
  if (!OneSignal) return false;

  try {
    await OneSignal.login(id);
    if (Object.keys(tags).length) {
      OneSignal.User.addTags(tags);
    }
    return true;
  } catch (err) {
    console.warn('[OneSignal] Falha ao identificar usuário:', err);
    return false;
  }
}

export async function requestOneSignalPermission(
  externalId: string,
  tags: OneSignalTags = {},
): Promise<boolean> {
  const OneSignal = await getOneSignal();
  if (!OneSignal) return false;

  try {
    await OneSignal.login(externalId.trim());
    if (Object.keys(tags).length) OneSignal.User.addTags(tags);

    if (!OneSignal.Notifications.permission) {
      await OneSignal.Notifications.requestPermission();
    }
    if (OneSignal.Notifications.permission && !OneSignal.User.PushSubscription.optedIn) {
      await OneSignal.User.PushSubscription.optIn();
    }
    return Boolean(OneSignal.Notifications.permission);
  } catch (err) {
    console.warn('[OneSignal] Falha ao ativar notificações:', err);
    return false;
  }
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
    const { data, error } = await supabase.rpc('visionfood_push_predictive_stock' as any, {
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
