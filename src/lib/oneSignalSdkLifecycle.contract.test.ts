// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc },
}));

const APP_A = '11111111-1111-4111-8111-111111111111';
const APP_B = '22222222-2222-4222-8222-222222222222';

function createSdk() {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue(undefined),
    User: {
      addTags: vi.fn(),
      PushSubscription: {
        optedIn: true,
        optIn: vi.fn().mockResolvedValue(undefined),
      },
    },
    Notifications: {
      permission: true,
      requestPermission: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function installDeferredSdk(sdk: ReturnType<typeof createSdk>) {
  const push = vi.fn((callback: (OneSignal: typeof sdk) => unknown) => {
    void callback(sdk);
    return 1;
  });
  Object.defineProperty(window, 'OneSignalDeferred', {
    configurable: true,
    writable: true,
    value: { push },
  });
  return push;
}

async function importOneSignal() {
  return import('@/lib/onesignal');
}

describe('OneSignal Web SDK lifecycle contract', () => {
  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    delete (window as any).OneSignalDeferred;
  });

  it('recovers when public config is initially disabled and becomes enabled without a page reload', async () => {
    const sdk = createSdk();
    installDeferredSdk(sdk);
    rpc
      .mockResolvedValueOnce({
        data: { ok: true, enabled: false, app_id: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, enabled: true, app_id: APP_A },
        error: null,
      });

    const { identifyOneSignalUser } = await importOneSignal();

    await expect(
      identifyOneSignalUser('user-a', { organization_id: 'org-a' }),
    ).resolves.toBe(false);
    await expect(
      identifyOneSignalUser('user-a', { organization_id: 'org-a' }),
    ).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith({
      appId: APP_A,
      notifyButton: { enable: false },
      serviceWorkerPath: '/onesignal/OneSignalSDKWorker.js',
      serviceWorkerParam: { scope: '/onesignal/' },
    });
    expect(sdk.login).toHaveBeenCalledWith('user-a');
    expect(sdk.User.addTags).toHaveBeenCalledWith({
      organization_id: 'org-a',
    });
  });

  it('fails closed instead of continuing to use an SDK initialized with a stale App ID', async () => {
    const sdk = createSdk();
    installDeferredSdk(sdk);
    rpc
      .mockResolvedValueOnce({
        data: { ok: true, enabled: true, app_id: APP_A },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, enabled: true, app_id: APP_B },
        error: null,
      });

    const { identifyOneSignalUser } = await importOneSignal();

    await expect(identifyOneSignalUser('user-a')).resolves.toBe(true);
    await expect(identifyOneSignalUser('user-b')).resolves.toBe(false);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.login).toHaveBeenCalledTimes(1);
    expect(sdk.login).toHaveBeenCalledWith('user-a');
  });

  it('deduplicates concurrent initialization for the same App ID', async () => {
    const sdk = createSdk();
    installDeferredSdk(sdk);
    rpc.mockResolvedValue({
      data: { ok: true, enabled: true, app_id: APP_A },
      error: null,
    });

    const { identifyOneSignalUser } = await importOneSignal();

    const [first, second] = await Promise.all([
      identifyOneSignalUser('user-a', { organization_id: 'org-a' }),
      identifyOneSignalUser('user-b', { organization_id: 'org-b' }),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.login).toHaveBeenCalledTimes(2);
    expect(sdk.User.addTags).toHaveBeenCalledWith({
      organization_id: 'org-a',
    });
    expect(sdk.User.addTags).toHaveBeenCalledWith({
      organization_id: 'org-b',
    });
  });
});
