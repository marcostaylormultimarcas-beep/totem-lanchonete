// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchPublicStorefrontConfigMock,
  fetchPublicCatalogMock,
} = vi.hoisted(() => ({
  fetchPublicStorefrontConfigMock: vi.fn(),
  fetchPublicCatalogMock: vi.fn(),
}));

vi.mock('@/contexts/OrgContext', () => ({
  useOrgId: () => 'org-a',
}));

vi.mock('@/lib/publicStorefrontConfig', () => ({
  fetchPublicStorefrontConfig: fetchPublicStorefrontConfigMock,
}));

vi.mock('@/lib/publicCatalog', () => ({
  fetchPublicCatalog: fetchPublicCatalogMock,
}));

vi.mock('@/components/kiosk/LoyaltyCard', () => ({
  default: () => null,
}));

vi.mock('@/components/kiosk/ProductModal', () => ({
  default: () => null,
}));

import StartScreen from '@/components/kiosk/StartScreen';

const CATALOG = [
  {
    id: 'prod-a',
    name: 'Produto A',
    price: 10,
    category: 'hamburgueres',
    image: '',
    removable_ingredients: [],
    extras: [],
    is_combo: false,
    ingredients: [],
    description: 'Descrição A',
    prep_time_min: 10,
  },
  {
    id: 'prod-b',
    name: 'Produto B',
    price: 20,
    category: 'bebidas',
    image: '',
    removable_ingredients: [],
    extras: [],
    is_combo: false,
    ingredients: [],
    description: 'Descrição B',
    prep_time_min: 5,
  },
];

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('StartScreen favorites bottom navigation', () => {
  let root: Root;
  let container: HTMLDivElement;

  const renderScreen = async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/loja/demo']}>
          <StartScreen onStart={vi.fn()} />
        </MemoryRouter>,
      );
      await flushAsync();
    });
  };

  const findButton = (text: string) =>
    Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes(text),
    ) as HTMLButtonElement | undefined;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();

    fetchPublicStorefrontConfigMock.mockResolvedValue({
      store_name: 'Loja Teste',
      banners: [],
      instagram_url: '',
      whatsapp_number: '',
      categories: [],
      category_icons: {},
    });
    fetchPublicCatalogMock.mockResolvedValue(CATALOG);

    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (container?.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('restores valid saved favorites and filters products from the bottom nav', async () => {
    localStorage.setItem('vf_favoritos', JSON.stringify(['prod-b']));

    await renderScreen();

    expect(container.textContent).toContain('Produto A');
    expect(container.textContent).toContain('Produto B');

    const favoritesButton = findButton('Favoritos');
    expect(favoritesButton).toBeTruthy();

    await act(async () => {
      favoritesButton!.click();
      await flushAsync();
    });

    expect(container.textContent).toContain('Favoritos');
    expect(container.textContent).not.toContain('Produto A');
    expect(container.textContent).toContain('Produto B');
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('persists add and remove operations through toggleFavorite', async () => {
    await renderScreen();

    const addButton = container.querySelector(
      'button[aria-label="Adicionar aos favoritos"]',
    ) as HTMLButtonElement | null;
    expect(addButton).toBeTruthy();

    await act(async () => {
      addButton!.click();
      await flushAsync();
    });

    expect(JSON.parse(localStorage.getItem('vf_favoritos') || '[]')).toEqual(['prod-a']);
    const removeButton = container.querySelector(
      'button[aria-label="Remover dos favoritos"]',
    ) as HTMLButtonElement | null;
    expect(removeButton).toBeTruthy();

    await act(async () => {
      removeButton!.click();
      await flushAsync();
    });

    expect(JSON.parse(localStorage.getItem('vf_favoritos') || '[]')).toEqual([]);
  });

  it('returns from favorites to the normal home slice through the bottom nav', async () => {
    localStorage.setItem('vf_favoritos', JSON.stringify(['prod-b']));

    await renderScreen();

    await act(async () => {
      findButton('Favoritos')!.click();
      await flushAsync();
    });
    expect(container.textContent).not.toContain('Produto A');

    await act(async () => {
      findButton('Início')!.click();
      await flushAsync();
    });

    expect(container.textContent).toContain('Produto A');
    expect(container.textContent).toContain('Produto B');
  });

  it('recovers from syntactically invalid stored JSON as an empty favorite list', async () => {
    localStorage.setItem('vf_favoritos', '{not-json');

    await renderScreen();

    expect(container.textContent).toContain('Produto A');
    expect(
      container.querySelectorAll('button[aria-label="Remover dos favoritos"]'),
    ).toHaveLength(0);
  });

  it('rejects a parseable string instead of treating it as a favorite-id collection', async () => {
    localStorage.setItem('vf_favoritos', JSON.stringify('prod-a'));

    await renderScreen();

    expect(container.textContent).toContain('Produto A');
    expect(
      container.querySelectorAll('button[aria-label="Remover dos favoritos"]'),
    ).toHaveLength(0);
  });

  it('keeps a visible banner when a storefront refresh shrinks the banner list', async () => {
    vi.useFakeTimers();

    const banner = (id: string, title: string) => ({
      id,
      title,
      image: `https://cdn.test/${id}.jpg`,
    });

    fetchPublicStorefrontConfigMock
      .mockResolvedValueOnce({
        store_name: 'Loja Teste',
        banners: [
          banner('banner-a', 'Banner A'),
          banner('banner-b', 'Banner B'),
          banner('banner-c', 'Banner C'),
          banner('banner-d', 'Banner D'),
        ],
        instagram_url: '',
        whatsapp_number: '',
        categories: [],
        category_icons: {},
      })
      .mockResolvedValue({
        store_name: 'Loja Teste',
        banners: [banner('banner-a', 'Banner A')],
        instagram_url: '',
        whatsapp_number: '',
        categories: [],
        category_icons: {},
      });

    await renderScreen();

    const fourthIndicator = container.querySelector(
      'button[aria-label="Banner 4"]',
    ) as HTMLButtonElement | null;
    expect(fourthIndicator).toBeTruthy();

    await act(async () => {
      fourthIndicator!.click();
      await flushAsync();
    });

    expect(
      container.querySelector('.vf-banner > button[aria-hidden="false"] img[alt="Banner D"]'),
    ).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushAsync();
    });

    expect(fetchPublicStorefrontConfigMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const visibleSlide = container.querySelector(
      '.vf-banner > button[aria-hidden="false"]',
    ) as HTMLButtonElement | null;
    expect(visibleSlide).toBeTruthy();
    expect(visibleSlide?.querySelector('img')?.getAttribute('alt')).toBe('Banner A');

    await act(async () => {
      vi.advanceTimersByTime(8_000);
      await flushAsync();
    });
    const stillVisibleSlide = container.querySelector(
      '.vf-banner > button[aria-hidden="false"]',
    ) as HTMLButtonElement | null;
    expect(stillVisibleSlide?.querySelector('img')?.getAttribute('alt')).toBe('Banner A');
  });


  it('ignores an older storefront response that finishes after a newer banner refresh', async () => {
    vi.useFakeTimers();

    const config = (id: string, title: string) => ({
      store_name: 'Loja Teste',
      banners: [{ id, title, image: `https://cdn.test/${id}.jpg` }],
      instagram_url: '',
      whatsapp_number: '',
      categories: [],
      category_icons: {},
    });

    let resolveOlder!: (value: ReturnType<typeof config>) => void;
    let resolveNewer!: (value: ReturnType<typeof config>) => void;
    const olderResponse = new Promise<ReturnType<typeof config>>(resolve => {
      resolveOlder = resolve;
    });
    const newerResponse = new Promise<ReturnType<typeof config>>(resolve => {
      resolveNewer = resolve;
    });

    fetchPublicStorefrontConfigMock
      .mockResolvedValueOnce(config('initial', 'Inicial'))
      .mockReturnValueOnce(olderResponse)
      .mockReturnValueOnce(newerResponse);

    await renderScreen();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushAsync();
    });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushAsync();
    });

    await act(async () => {
      resolveNewer(config('newest', 'Mais novo'));
      await flushAsync();
    });
    expect(container.querySelector('img[alt="Mais novo"]')).toBeTruthy();

    await act(async () => {
      resolveOlder(config('stale', 'Antigo'));
      await flushAsync();
    });

    expect(container.querySelector('img[alt="Mais novo"]')).toBeTruthy();
    expect(container.querySelector('img[alt="Antigo"]')).toBeFalsy();
  });


  it('gives a manually selected banner a fresh four-second autoplay window', async () => {
    vi.useFakeTimers();

    fetchPublicStorefrontConfigMock.mockResolvedValue({
      store_name: 'Loja Teste',
      banners: [
        { id: 'banner-a', title: 'Banner A', image: 'https://cdn.test/a.jpg' },
        { id: 'banner-b', title: 'Banner B', image: 'https://cdn.test/b.jpg' },
        { id: 'banner-c', title: 'Banner C', image: 'https://cdn.test/c.jpg' },
      ],
      instagram_url: '',
      whatsapp_number: '',
      categories: [],
      category_icons: {},
    });

    await renderScreen();

    await act(async () => {
      vi.advanceTimersByTime(3_900);
      await flushAsync();
    });

    const secondIndicator = container.querySelector(
      'button[aria-label="Banner 2"]',
    ) as HTMLButtonElement | null;
    expect(secondIndicator).toBeTruthy();

    await act(async () => {
      secondIndicator!.click();
      await flushAsync();
    });
    expect(container.querySelector('img[alt="Banner B"]')?.closest('button')?.getAttribute('aria-hidden')).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(100);
      await flushAsync();
    });
    expect(container.querySelector('img[alt="Banner B"]')?.closest('button')?.getAttribute('aria-hidden')).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(3_899);
      await flushAsync();
    });
    expect(container.querySelector('img[alt="Banner B"]')?.closest('button')?.getAttribute('aria-hidden')).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(1);
      await flushAsync();
    });
    expect(container.querySelector('img[alt="Banner C"]')?.closest('button')?.getAttribute('aria-hidden')).toBe('false');
  });


  it('autoplays to the next banner only after four seconds', async () => {
    vi.useFakeTimers();

    fetchPublicStorefrontConfigMock.mockResolvedValue({
      store_name: 'Loja Teste',
      banners: [
        { id: 'banner-a', title: 'Banner A', image: 'https://cdn.test/a.jpg' },
        { id: 'banner-b', title: 'Banner B', image: 'https://cdn.test/b.jpg' },
      ],
      instagram_url: '',
      whatsapp_number: '',
      categories: [],
      category_icons: {},
    });

    await renderScreen();

    await act(async () => {
      vi.advanceTimersByTime(3_999);
      await flushAsync();
    });
    expect(container.querySelector('img[alt="Banner A"]')?.closest('button')?.getAttribute('aria-hidden')).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(1);
      await flushAsync();
    });
    expect(container.querySelector('img[alt="Banner B"]')?.closest('button')?.getAttribute('aria-hidden')).toBe('false');
  });

  it('swipes both directions, suppresses the swipe click, and allows the next deliberate tap', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    fetchPublicStorefrontConfigMock.mockResolvedValue({
      store_name: 'Loja Teste',
      banners: [
        { id: 'banner-a', title: 'Banner A', image: 'https://cdn.test/a.jpg', link: 'https://example.test/a' },
        { id: 'banner-b', title: 'Banner B', image: 'https://cdn.test/b.jpg', link: 'https://example.test/b' },
      ],
      instagram_url: '',
      whatsapp_number: '',
      categories: [],
      category_icons: {},
    });

    await renderScreen();

    const bannerRoot = container.querySelector('.vf-banner') as HTMLDivElement | null;
    expect(bannerRoot).toBeTruthy();

    const dispatchTouch = (type: 'touchstart' | 'touchend', clientX: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', {
        configurable: true,
        value: [{ clientX }],
      });
      bannerRoot!.dispatchEvent(event);
    };

    await act(async () => {
      dispatchTouch('touchstart', 200);
      dispatchTouch('touchend', 100);
      await flushAsync();
    });
    const bannerBButton = container.querySelector('img[alt="Banner B"]')?.closest('button') as HTMLButtonElement | null;
    expect(bannerBButton?.getAttribute('aria-hidden')).toBe('false');

    await act(async () => {
      bannerBButton!.click();
      await flushAsync();
    });
    expect(openSpy).not.toHaveBeenCalled();

    await act(async () => {
      dispatchTouch('touchstart', 100);
      dispatchTouch('touchend', 100);
      bannerBButton!.click();
      await flushAsync();
    });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('https://example.test/b', '_blank', 'noopener');

    await act(async () => {
      dispatchTouch('touchstart', 100);
      dispatchTouch('touchend', 200);
      await flushAsync();
    });
    expect(container.querySelector('img[alt="Banner A"]')?.closest('button')?.getAttribute('aria-hidden')).toBe('false');
  });


  it('rejects parseable null instead of crashing the storefront', async () => {
    localStorage.setItem('vf_favoritos', 'null');

    await renderScreen();

    expect(container.textContent).toContain('Produto A');
    expect(container.textContent).toContain('Produto B');
  });
});
