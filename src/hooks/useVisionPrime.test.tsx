// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock, getUserMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: rpcMock,
    auth: {
      getUser: getUserMock,
    },
  },
}));

import {
  useVisionPrimeConfig,
  useVisionPrimeStatus,
  type VisionPrimeConfig,
  type VisionPrimeStatus,
} from '@/hooks/useVisionPrime';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useVisionPrime', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('does not expose the previous store config while a new store is loading', async () => {
    const configA = deferred<{ data: VisionPrimeConfig | null; error: unknown }>();
    const configB = deferred<{ data: VisionPrimeConfig | null; error: unknown }>();

    rpcMock.mockImplementation((name: string, args: { _org: string }) => {
      expect(name).toBe('vision_prime_public_config');
      return {
        maybeSingle: () => args._org === 'org-a' ? configA.promise : configB.promise,
      };
    });

    let latest: ReturnType<typeof useVisionPrimeConfig> | null = null;
    const Probe = ({ orgId }: { orgId: string }) => {
      latest = useVisionPrimeConfig(orgId);
      return null;
    };

    await act(async () => {
      root.render(<Probe orgId="org-a" />);
    });

    await act(async () => {
      configA.resolve({
        data: {
          ativo: true,
          valor_mensalidade: 29.9,
          desconto_percentual: 20,
          frete_gratis_minimo: 50,
        },
        error: null,
      });
      await configA.promise;
    });

    expect(latest?.config?.desconto_percentual).toBe(20);
    expect(latest?.loading).toBe(false);

    await act(async () => {
      root.render(<Probe orgId="org-b" />);
    });

    expect(latest?.config).toBeNull();
    expect(latest?.loading).toBe(true);

    await act(async () => {
      configB.resolve({
        data: {
          ativo: true,
          valor_mensalidade: 19.9,
          desconto_percentual: 5,
          frete_gratis_minimo: 80,
        },
        error: null,
      });
      await configB.promise;
    });

    expect(latest?.config?.desconto_percentual).toBe(5);
    expect(latest?.loading).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it('ignores a stale membership response after the organization changes', async () => {
    const statusA = deferred<{ data: unknown; error: unknown }>();
    const statusB = deferred<{ data: unknown; error: unknown }>();

    getUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    rpcMock.mockImplementation((name: string, args: { _org: string }) => {
      expect(name).toBe('vision_prime_my_status');
      return args._org === 'org-a' ? statusA.promise : statusB.promise;
    });

    let latest: { status: VisionPrimeStatus; loading: boolean } | null = null;
    const Probe = ({ orgId }: { orgId: string }) => {
      const value = useVisionPrimeStatus(orgId);
      latest = { status: value.status, loading: value.loading };
      return null;
    };

    await act(async () => {
      root.render(<Probe orgId="org-a" />);
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<Probe orgId="org-b" />);
      await Promise.resolve();
    });

    expect(latest?.status.active).toBe(false);
    expect(latest?.loading).toBe(true);

    await act(async () => {
      statusB.resolve({ data: { active: false }, error: null });
      await statusB.promise;
    });

    expect(latest?.status.active).toBe(false);
    expect(latest?.loading).toBe(false);

    await act(async () => {
      statusA.resolve({ data: { active: true, since_year: 2024 }, error: null });
      await statusA.promise;
    });

    expect(latest?.status.active).toBe(false);
    expect(latest?.status.sinceYear).toBeUndefined();

    await act(async () => root.unmount());
    container.remove();
  });
});
