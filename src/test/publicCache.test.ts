import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPublicDataWithFallback, readPublicCache, writePublicCache } from '@/lib/publicCache';

const memory = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => memory.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { memory.set(key, value); }),
  removeItem: vi.fn((key: string) => { memory.delete(key); }),
  clear: vi.fn(() => memory.clear()),
  key: vi.fn((index: number) => Array.from(memory.keys())[index] ?? null),
  get length() { return memory.size; },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });

describe('publicCache', () => {
  beforeEach(() => {
    memory.clear();
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  });

  it('keeps a last-known-good public snapshot regardless of age', () => {
    memory.set('public:test', JSON.stringify({
      savedAt: '2020-01-01T00:00:00.000Z',
      data: { store_name: 'VisionFood' },
    }));
    expect(readPublicCache<{ store_name: string }>('public:test')?.data.store_name).toBe('VisionFood');
  });

  it('uses cached public data immediately when the browser is known offline', async () => {
    writePublicCache('public:test', { value: 1 });
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    const loader = vi.fn(async () => ({ value: 2 }));
    await expect(loadPublicDataWithFallback('public:test', loader)).resolves.toEqual({ value: 1 });
    expect(loader).not.toHaveBeenCalled();
  });

  it('falls back to the cached snapshot when an online refresh fails', async () => {
    writePublicCache('public:test', { value: 1 });
    const loader = vi.fn(async () => { throw new Error('offline'); });
    await expect(loadPublicDataWithFallback('public:test', loader)).resolves.toEqual({ value: 1 });
  });

  it('stores and returns fresh public data when online', async () => {
    const loader = vi.fn(async () => ({ value: 2 }));
    await expect(loadPublicDataWithFallback('public:test', loader)).resolves.toEqual({ value: 2 });
    expect(readPublicCache<{ value: number }>('public:test')?.data).toEqual({ value: 2 });
  });
});
