// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
      removeTags: vi.fn().mockResolvedValue(undefined),
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
  return import('@/lib/onesignal') as Promise<any>;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('OneSignal identity lifecycle contract', () => {
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

  it('does not report identity success before user tags are durably applied', async () => {
    const sdk = createSdk();
    const tags = deferred<void>();
    sdk.User.addTags.mockImplementation(() => tags.promise);
    installDeferredSdk(sdk);

    const { identifyOneSignalUser } = await importOneSignal();

    let settled = false;
    const result = identifyOneSignalUser('5511999999999', {
      tipo: 'customer',
      organization_id: 'org-a',
    }).then((value: boolean) => {
      settled = true;
      return value;
    });

    await vi.waitFor(() => {
      expect(sdk.User.addTags).toHaveBeenCalledWith({
        tipo: 'customer',
        organization_id: 'org-a',
      });
    });
    expect(settled).toBe(false);

    tags.resolve();
    await expect(result).resolves.toBe(true);
  });

  it('serializes competing identity changes so the most recently requested identity wins deterministically', async () => {
    const sdk = createSdk();
    const firstLogin = deferred<void>();
    sdk.login
      .mockImplementationOnce(() => firstLogin.promise)
      .mockResolvedValueOnce(undefined);
    installDeferredSdk(sdk);

    const { identifyOneSignalUser } = await importOneSignal();

    const first = identifyOneSignalUser('5511111111111', {
      organization_id: 'org-a',
    });
    const second = identifyOneSignalUser('5522222222222', {
      organization_id: 'org-b',
    });

    await vi.waitFor(() => {
      expect(sdk.login).toHaveBeenCalled();
    });

    expect(sdk.login).toHaveBeenCalledTimes(1);
    expect(sdk.login).toHaveBeenNthCalledWith(1, '5511111111111');

    firstLogin.resolve();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);

    expect(sdk.login).toHaveBeenCalledTimes(2);
    expect(sdk.login).toHaveBeenNthCalledWith(2, '5522222222222');
    expect(sdk.User.addTags).toHaveBeenNthCalledWith(1, {
      organization_id: 'org-a',
    });
    expect(sdk.User.addTags).toHaveBeenNthCalledWith(2, {
      organization_id: 'org-b',
    });
  });

  it('exposes a serialized logout that detaches the current browser subscription from the external user', async () => {
    const sdk = createSdk();
    installDeferredSdk(sdk);

    const OneSignalModule = await importOneSignal();
    expect(typeof OneSignalModule.logoutOneSignalUser).toBe('function');

    await expect(
      OneSignalModule.identifyOneSignalUser('5511999999999', {
        organization_id: 'org-a',
      }),
    ).resolves.toBe(true);

    await expect(OneSignalModule.logoutOneSignalUser()).resolves.toBe(true);
    expect(sdk.logout).toHaveBeenCalledTimes(1);
  });

  it('detaches OneSignal identity in the explicit customer logout flow before reloading the kiosk', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'pages', 'OrderHistory.tsx'),
      'utf8',
    );

    expect(source).toContain("import { logoutOneSignalUser } from '@/lib/onesignal'");
    const logoutCall = source.indexOf('await logoutOneSignalUser()');
    const reload = source.indexOf('window.location.replace(getKioskHomePath())');

    expect(logoutCall).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(logoutCall);
  });



  it('detaches OneSignal identity in the shared complete sign-out helper before navigation', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'lib', 'auth.ts'),
      'utf8',
    );

    expect(source).toContain("import { logoutOneSignalUser } from '@/lib/onesignal'");
    const logoutCall = source.indexOf('await logoutOneSignalUser()');
    const reload = source.indexOf('window.location.replace(redirectTo)');

    expect(logoutCall).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(logoutCall);
  });

  it('detaches OneSignal identity after a successful password-recovery sign-out', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'pages', 'ResetPassword.tsx'),
      'utf8',
    );

    expect(source).toContain("import { logoutOneSignalUser } from '@/lib/onesignal'");
    expect(source).toMatch(
      /const\s+signedOut\s*=\s*await\s+signOutRecoverySession\(\)[\s\S]*?if\s*\(!signedOut\)[\s\S]*?return;[\s\S]*?await\s+logoutOneSignalUser\(\)[\s\S]*?navigate\('\/auth'/,
    );
  });

  it('detaches a prior customer identity when a browser is cut over to device-owned kiosk mode', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'pages', 'Index.tsx'),
      'utf8',
    );

    expect(source).toContain("import { logoutOneSignalUser } from '@/lib/onesignal'");
    expect(source).toMatch(
      /if\s*\(deviceOwned\)\s*\{[\s\S]*?logoutOneSignalUser\(\)[\s\S]*?auth\.signOut\(\{\s*scope:\s*'local'\s*\}\)/,
    );
  });
});
