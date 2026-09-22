import { act, renderHook, waitFor } from '@testing-library/react';
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

describe('useStoreTheme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('style');
    document.documentElement.classList.remove('theme-light');
  });

  it('clears loading and ignores a stale response when the organization is removed', async () => {
    const pending = deferred<{
      primary_color?: string;
      secondary_color?: string;
      mode?: 'dark' | 'light' | string;
    }>();
    fetchPublicThemeMock.mockReturnValueOnce(pending.promise);

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string | null }) => useStoreTheme(orgId),
      { initialProps: { orgId: 'org-a' as string | null } },
    );

    await waitFor(() => expect(result.current.loading).toBe(true));

    rerender({ orgId: null });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.theme).toEqual(DEFAULT_THEME);
    });

    await act(async () => {
      pending.resolve({
        primary_color: '210 80% 45%',
        secondary_color: '120 70% 40%',
        mode: 'light',
      });
      await pending.promise;
    });

    expect(result.current.theme).toEqual(DEFAULT_THEME);
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe(DEFAULT_THEME.primary_color);
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);
  });
});
