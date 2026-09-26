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
  });


  it('rejects parseable null instead of crashing the storefront', async () => {
    localStorage.setItem('vf_favoritos', 'null');

    await renderScreen();

    expect(container.textContent).toContain('Produto A');
    expect(container.textContent).toContain('Produto B');
  });
});
