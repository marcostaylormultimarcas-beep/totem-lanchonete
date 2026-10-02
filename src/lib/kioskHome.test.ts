import { afterEach, describe, expect, it, vi } from 'vitest';
import { getKioskHomePath } from '@/lib/kioskHome';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getKioskHomePath', () => {
  it('falls back safely when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(getKioskHomePath()).toBe('/');
  });

  it('does not read storage when an explicit slug is provided', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');

    expect(getKioskHomePath('minha-loja')).toBe('/cardapio/minha-loja');
    expect(getItem).not.toHaveBeenCalled();
  });
});
