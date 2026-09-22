import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, useStoreTheme } from '@/hooks/useStoreTheme';
import { fetchPublicTheme } from '@/lib/publicTheme';

vi.mock('@/lib/publicTheme', () => ({
  fetchPublicTheme: vi.fn(),
}));

const fetchPublicThemeMock = vi.mocked(fetchPublicTheme);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type HookValue = ReturnType<typeof useStoreTheme>;

describe('useStoreTheme', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let latest: HookValue | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('style');
    document.documentElement.classList.remove('theme-light');
    latest = null;
    container = document.createElement('div');
    root = createRoot(container);
  });

  it('clears loading and ignores a stale response when the organization is removed', async () => {
    const pending = deferred<{
      primary_color?: string;
      secondary_color?: string;
      mode?: 'dark' | 'light' | string;
    }>();
    fetchPublicThemeMock.mockReturnValueOnce(pending.promise);

    const Probe = ({ orgId }: { orgId: string | null }) => {
      latest = useStoreTheme(orgId);
      return null;
    };

    await act(async () => {
      root!.render(<Probe orgId="org-a" />);
    });

    expect(latest?.loading).toBe(true);

    await act(async () => {
      root!.render(<Probe orgId={null} />);
    });

    expect(latest?.loading).toBe(false);
    expect(latest?.theme).toEqual(DEFAULT_THEME);

    await act(async () => {
      pending.resolve({
        primary_color: '210 80% 45%',
        secondary_color: '120 70% 40%',
        mode: 'light',
      });
      await pending.promise;
    });

    expect(latest?.theme).toEqual(DEFAULT_THEME);
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe(DEFAULT_THEME.primary_color);
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);

    await act(async () => {
      root!.unmount();
    });
  });
});
