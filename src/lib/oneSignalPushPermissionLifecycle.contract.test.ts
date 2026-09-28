// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc },
}));

const APP_ID = '11111111-1111-4111-8111-111111111111';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createSdk() {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    User: {
      addTags: vi.fn().mockResolvedValue(undefined),
      PushSubscription: {
        optedIn: true,
        optIn: vi.fn().mockResolvedValue(undefined),
        optOut: vi.fn().mockResolvedValue(undefined),
      },
    },
    Notifications: {
      permission: true,
      permissionNative: 'granted',
      requestPermission: vi.fn().mockResolvedValue(true),
    },
  };
}

function installDeferredSdk(sdk: ReturnType<typeof createSdk>) {
  Object.defineProperty(window, 'OneSignalDeferred', {
    configurable: true,
    writable: true,
    value: {
      push: vi.fn((callback: (OneSignal: typeof sdk) => unknown) => {
        void callback(sdk);
        return 1;
      }),
    },
  });
}

async function importOneSignal() {
  return import('@/lib/onesignal');
}

describe('OneSignal push permission lifecycle contract', () => {
  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
    rpc.mockResolvedValue({
      data: { ok: true, enabled: true, app_id: APP_ID },
      error: null,
    });
    document.head.innerHTML = '';
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    delete (window as any).OneSignalDeferred;
  });

  it('keeps already-granted and already-opted-in subscriptions idempotent', async () => {
    const sdk = createSdk();
    installDeferredSdk(sdk);

    const { requestOneSignalPermission } = await importOneSignal();

    await expect(
      requestOneSignalPermission('5511999999999', {
        tipo: 'customer',
        organization_id: 'org-a',
      }),
    ).resolves.toBe(true);

    expect(sdk.Notifications.requestPermission).not.toHaveBeenCalled();
    expect(sdk.User.PushSubscription.optIn).not.toHaveBeenCalled();
  });

  it('fails closed when native permission is denied', async () => {
    const sdk = createSdk();
    sdk.Notifications.permission = false;
    sdk.Notifications.permissionNative = 'denied';
    sdk.Notifications.requestPermission.mockResolvedValue(false);
    sdk.User.PushSubscription.optedIn = false;
    installDeferredSdk(sdk);

    const { requestOneSignalPermission } = await importOneSignal();

    await expect(
      requestOneSignalPermission('5511999999999', {
        organization_id: 'org-a',
      }),
    ).resolves.toBe(false);

    expect(sdk.User.PushSubscription.optIn).not.toHaveBeenCalled();
  });

  it('uses the requestPermission result when the permission getter has not refreshed yet', async () => {
    const sdk = createSdk();
    sdk.Notifications.permission = false;
    sdk.Notifications.permissionNative = 'default';
    sdk.Notifications.requestPermission.mockResolvedValue(true);
    sdk.User.PushSubscription.optedIn = false;
    sdk.User.PushSubscription.optIn.mockImplementation(async () => {
      sdk.User.PushSubscription.optedIn = true;
    });
    installDeferredSdk(sdk);

    const { requestOneSignalPermission } = await importOneSignal();

    await expect(
      requestOneSignalPermission('5511999999999', {
        tipo: 'customer',
        organization_id: 'org-a',
      }),
    ).resolves.toBe(true);

    expect(sdk.Notifications.requestPermission).toHaveBeenCalledTimes(1);
    expect(sdk.User.PushSubscription.optIn).toHaveBeenCalledTimes(1);
  });

  it('does not report success when optIn completes but the subscription is still opted out', async () => {
    const sdk = createSdk();
    sdk.Notifications.permission = true;
    sdk.Notifications.permissionNative = 'granted';
    sdk.User.PushSubscription.optedIn = false;
    sdk.User.PushSubscription.optIn.mockResolvedValue(undefined);
    installDeferredSdk(sdk);

    const { requestOneSignalPermission } = await importOneSignal();

    await expect(
      requestOneSignalPermission('5511999999999', {
        tipo: 'customer',
        organization_id: 'org-a',
      }),
    ).resolves.toBe(false);

    expect(sdk.User.PushSubscription.optIn).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the permission request throws', async () => {
    const sdk = createSdk();
    sdk.Notifications.permission = false;
    sdk.Notifications.permissionNative = 'default';
    sdk.Notifications.requestPermission.mockRejectedValue(
      new Error('permission_request_failed'),
    );
    sdk.User.PushSubscription.optedIn = false;
    installDeferredSdk(sdk);

    const { requestOneSignalPermission } = await importOneSignal();

    await expect(
      requestOneSignalPermission('5511999999999', {
        organization_id: 'org-a',
      }),
    ).resolves.toBe(false);

    expect(sdk.User.PushSubscription.optIn).not.toHaveBeenCalled();
  });

  it('fails closed when optIn throws after permission is granted', async () => {
    const sdk = createSdk();
    sdk.Notifications.permission = true;
    sdk.Notifications.permissionNative = 'granted';
    sdk.User.PushSubscription.optedIn = false;
    sdk.User.PushSubscription.optIn.mockRejectedValue(new Error('opt_in_failed'));
    installDeferredSdk(sdk);

    const { requestOneSignalPermission } = await importOneSignal();

    await expect(
      requestOneSignalPermission('5511999999999', {
        organization_id: 'org-a',
      }),
    ).resolves.toBe(false);
  });

  it('serializes a user change while a permission prompt is in flight and avoids a duplicate prompt', async () => {
    const sdk = createSdk();
    const promptGate = deferred<void>();
    sdk.Notifications.permission = false;
    sdk.Notifications.permissionNative = 'default';
    sdk.Notifications.requestPermission.mockImplementation(async () => {
      await promptGate.promise;
      sdk.Notifications.permission = true;
      sdk.Notifications.permissionNative = 'granted';
      return true;
    });
    sdk.User.PushSubscription.optedIn = true;
    installDeferredSdk(sdk);

    const { requestOneSignalPermission } = await importOneSignal();

    const first = requestOneSignalPermission('5511111111111', {
      organization_id: 'org-a',
    });
    const second = requestOneSignalPermission('5522222222222', {
      organization_id: 'org-b',
    });

    await vi.waitFor(() => {
      expect(sdk.Notifications.requestPermission).toHaveBeenCalledTimes(1);
    });
    expect(sdk.login).toHaveBeenCalledTimes(1);
    expect(sdk.login).toHaveBeenNthCalledWith(1, '5511111111111');

    promptGate.resolve();

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);

    expect(sdk.Notifications.requestPermission).toHaveBeenCalledTimes(1);
    expect(sdk.login).toHaveBeenCalledTimes(2);
    expect(sdk.login).toHaveBeenNthCalledWith(2, '5522222222222');
    expect(sdk.User.addTags).toHaveBeenNthCalledWith(1, {
      organization_id: 'org-a',
    });
    expect(sdk.User.addTags).toHaveBeenNthCalledWith(2, {
      organization_id: 'org-b',
    });
  });
});
