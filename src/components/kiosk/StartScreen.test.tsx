// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchPublicStorefrontConfigMock,
  fetchPublicCatalogMock,
  useVisionPrimeConfigMock,
} = vi.hoisted(() => ({
  fetchPublicStorefrontConfigMock: vi.fn(),
  fetchPublicCatalogMock: vi.fn(),
  useVisionPrimeConfigMock: vi.fn(),
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

vi.mock('@/hooks/useVisionPrime', () => ({
  useVisionPrimeConfig: useVisionPrimeConfigMock,
}));

vi.mock('@/components/kiosk/LoyaltyCard', () => ({
  default: () => null,
}));

vi.mock('@/components/kiosk/ProductModal', () => ({
  default: ({ product }: { product: { name: string } }) => `Product modal: ${product.name}`,
}));

import StartScreen from '@/components/kiosk/StartScreen';

function RouteProbe() {
  const location = useLocation();
  return <output data-testid="route-probe">{location.pathname}</output>;
}

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

  const renderScreen = async (props: Partial<React.ComponentProps<typeof StartScreen>> = {}) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/loja/demo']}>
          <StartScreen onStart={vi.fn()} {...props} />
          <RouteProbe />
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
    useVisionPrimeConfigMock.mockReturnValue({
      config: null,
      loading: false,
    });

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

  it('ignores an older catalog response that finishes after a newer product refresh', async () => {
    vi.useFakeTimers();

    const catalogProduct = (id: string, name: string) => ({
      id,
      name,
      price: 10,
      category: 'hamburgueres',
      image: '',
      removable_ingredients: [],
      extras: [],
      is_combo: false,
      ingredients: [],
      description: name,
      prep_time_min: 10,
    });

    let resolveOlder!: (value: ReturnType<typeof catalogProduct>[]) => void;
    let resolveNewer!: (value: ReturnType<typeof catalogProduct>[]) => void;
    const olderResponse = new Promise<ReturnType<typeof catalogProduct>[]>(resolve => {
      resolveOlder = resolve;
    });
    const newerResponse = new Promise<ReturnType<typeof catalogProduct>[]>(resolve => {
      resolveNewer = resolve;
    });

    fetchPublicCatalogMock
      .mockResolvedValueOnce([catalogProduct('initial', 'Produto inicial')])
      .mockReturnValueOnce(olderResponse)
      .mockReturnValueOnce(newerResponse);

    await renderScreen();
    expect(container.textContent).toContain('Produto inicial');

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushAsync();
    });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushAsync();
    });

    await act(async () => {
      resolveNewer([catalogProduct('newest', 'Produto mais novo')]);
      await flushAsync();
    });
    expect(container.textContent).toContain('Produto mais novo');

    await act(async () => {
      resolveOlder([catalogProduct('stale', 'Produto antigo')]);
      await flushAsync();
    });

    expect(container.textContent).toContain('Produto mais novo');
    expect(container.textContent).not.toContain('Produto antigo');
  });


  it('shows only the first six non-combo products in normal mode', async () => {
    const manyProducts = [
      {
        ...CATALOG[0],
        id: 'combo-hidden',
        name: 'Combo oculto',
        is_combo: true,
      },
      ...Array.from({ length: 7 }, (_, index) => ({
        ...CATALOG[0],
        id: `prod-${index + 1}`,
        name: `Produto ${index + 1}`,
        is_combo: false,
      })),
    ];
    fetchPublicCatalogMock.mockResolvedValue(manyProducts);

    await renderScreen();

    expect(container.textContent).not.toContain('Combo oculto');
    for (let index = 1; index <= 6; index += 1) {
      expect(container.textContent).toContain(`Produto ${index}`);
    }
    expect(container.textContent).not.toContain('Produto 7');
  });

  it('sends a card click to onSelectProduct exactly once', async () => {
    const onSelectProduct = vi.fn();
    const onAddToCart = vi.fn();

    await renderScreen({ onSelectProduct, onAddToCart });

    const productHeading = Array.from(container.querySelectorAll('h3')).find(
      heading => heading.textContent === 'Produto A',
    );
    const productButton = productHeading?.closest('button') as HTMLButtonElement | null;
    expect(productButton).toBeTruthy();

    await act(async () => {
      productButton!.click();
      await flushAsync();
    });

    expect(onSelectProduct).toHaveBeenCalledTimes(1);
    expect(onSelectProduct).toHaveBeenCalledWith(expect.objectContaining({ id: 'prod-a', name: 'Produto A' }));
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it('opens the selected-product modal when a card has no selection callback', async () => {
    await renderScreen();

    const productHeading = Array.from(container.querySelectorAll('h3')).find(
      heading => heading.textContent === 'Produto A',
    );
    const productButton = productHeading?.closest('button') as HTMLButtonElement | null;
    expect(productButton).toBeTruthy();

    await act(async () => {
      productButton!.click();
      await flushAsync();
    });

    expect(container.textContent).toContain('Product modal: Produto A');
  });

  it('prioritizes onSelectProduct over onAddToCart for quick add', async () => {
    const onSelectProduct = vi.fn();
    const onAddToCart = vi.fn();

    await renderScreen({ onSelectProduct, onAddToCart });

    const quickAdd = container.querySelector('button[title="Adicionar"]') as HTMLButtonElement | null;
    expect(quickAdd).toBeTruthy();

    await act(async () => {
      quickAdd!.click();
      await flushAsync();
    });

    expect(onSelectProduct).toHaveBeenCalledTimes(1);
    expect(onSelectProduct).toHaveBeenCalledWith(expect.objectContaining({ id: 'prod-a' }));
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it('creates a quantity-one CartItem when quick add uses onAddToCart', async () => {
    const onAddToCart = vi.fn();

    await renderScreen({ onAddToCart });

    const quickAdd = container.querySelector('button[title="Adicionar"]') as HTMLButtonElement | null;
    expect(quickAdd).toBeTruthy();

    await act(async () => {
      quickAdd!.click();
      await flushAsync();
    });

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    const item = onAddToCart.mock.calls[0][0];
    expect(item).toMatchObject({
      product: expect.objectContaining({ id: 'prod-a', name: 'Produto A' }),
      quantity: 1,
      removedIngredients: [],
      selectedExtras: [],
    });
    expect(typeof item.id).toBe('string');
    expect(item.id.length).toBeGreaterThan(0);
  });

  it('opens ProductModal as the quick-add fallback when no callbacks exist', async () => {
    await renderScreen();

    const quickAdd = container.querySelector('button[title="Adicionar"]') as HTMLButtonElement | null;
    expect(quickAdd).toBeTruthy();

    await act(async () => {
      quickAdd!.click();
      await flushAsync();
    });

    expect(container.textContent).toContain('Product modal: Produto A');
  });

  it('isolates heart and quick-add clicks from the card click handler', async () => {
    const onSelectProduct = vi.fn();

    await renderScreen({ onSelectProduct });

    const favorite = container.querySelector(
      'button[aria-label="Adicionar aos favoritos"]',
    ) as HTMLButtonElement | null;
    const quickAdd = container.querySelector('button[title="Adicionar"]') as HTMLButtonElement | null;
    expect(favorite).toBeTruthy();
    expect(quickAdd).toBeTruthy();

    await act(async () => {
      favorite!.click();
      await flushAsync();
    });
    expect(onSelectProduct).not.toHaveBeenCalled();

    await act(async () => {
      quickAdd!.click();
      await flushAsync();
    });
    expect(onSelectProduct).toHaveBeenCalledTimes(1);
  });


  it('falls back to default categories when a storefront refresh removes configured categories', async () => {
    vi.useFakeTimers();

    fetchPublicStorefrontConfigMock
      .mockResolvedValueOnce({
        store_name: 'Loja Teste',
        banners: [],
        instagram_url: '',
        whatsapp_number: '',
        categories: [
          { key: 'sobremesas', label: 'Sobremesas', icon: '🍰' },
        ],
      })
      .mockResolvedValue({
        store_name: 'Loja Teste',
        banners: [],
        instagram_url: '',
        whatsapp_number: '',
        categories: [],
      });

    await renderScreen();

    expect(container.textContent).toContain('Sobremesas');
    expect(container.textContent).not.toContain('Hambúrgueres');

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushAsync();
    });

    expect(container.textContent).not.toContain('Sobremesas');
    expect(container.textContent).toContain('Hambúrgueres');
    expect(container.textContent).toContain('Pizzas');
    expect(container.textContent).toContain('Bebidas');
  });


  it('starts the flow exactly once from the search shortcut', async () => {
    const onStart = vi.fn();
    await renderScreen({ onStart });

    const searchButton = findButton('Buscar pratos, bebidas e mais');
    expect(searchButton).toBeTruthy();

    await act(async () => {
      searchButton!.click();
      await flushAsync();
    });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('starts the flow exactly once from the bottom navigation search shortcut', async () => {
    const onStart = vi.fn();
    await renderScreen({ onStart });

    const bottomSearchButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Buscar',
    ) as HTMLButtonElement | undefined;
    expect(bottomSearchButton).toBeTruthy();

    await act(async () => {
      bottomSearchButton!.click();
      await flushAsync();
    });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('starts the flow exactly once from categories Ver todas', async () => {
    const onStart = vi.fn();
    await renderScreen({ onStart });

    const allCategoriesButton = findButton('Ver todas');
    expect(allCategoriesButton).toBeTruthy();

    await act(async () => {
      allCategoriesButton!.click();
      await flushAsync();
    });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('selects a category visually and starts the flow exactly once', async () => {
    const onStart = vi.fn();
    await renderScreen({ onStart });

    const categoryButton = findButton('Hambúrgueres');
    expect(categoryButton).toBeTruthy();

    await act(async () => {
      categoryButton!.click();
      await flushAsync();
    });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(categoryButton!.querySelector('div')?.className).toContain('border-2');
    expect(categoryButton!.querySelector('div')?.className).toContain('border-[#FF7A00]');
    const categoryLabel = Array.from(categoryButton!.querySelectorAll('span')).find(
      span => span.textContent === 'Hambúrgueres',
    );
    expect(categoryLabel?.className).toContain('text-[#FF7A00]');
  });

  it('uses configured public categories instead of the default fallback', async () => {
    fetchPublicStorefrontConfigMock.mockResolvedValue({
      store_name: 'Loja Teste',
      banners: [],
      instagram_url: '',
      whatsapp_number: '',
      categories: [
        { key: 'doces', label: 'Doces da casa', icon: '🍰' },
      ],
    });

    await renderScreen();

    expect(container.textContent).toContain('Doces da casa');
    expect(container.textContent).not.toContain('Hambúrgueres');
    expect(container.textContent).not.toContain('Pizzas');
    expect(container.textContent).not.toContain('Bebidas');
  });


  it('covers header navigation visibility and cart badge', async () => {
    await renderScreen({ cartCount: 3 });

    const clubLink = container.querySelector('a[title="Clube"]') as HTMLAnchorElement | null;
    const ordersLink = container.querySelector('a[title="Meus Pedidos"]') as HTMLAnchorElement | null;
    expect(clubLink?.getAttribute('href')).toBe('/clube');
    expect(ordersLink?.getAttribute('href')).toBe('/meus-pedidos');
    expect(ordersLink?.textContent).toContain('3');

    await renderScreen({ cartCount: 0 });
    expect(container.querySelector('a[title="Meus Pedidos"] span')).toBeNull();

    await renderScreen({ cartCount: 0, deviceOwnedKiosk: true });

    expect(container.querySelector('a[title="Clube"]')).toBeNull();
    expect(container.querySelector('a[title="Meus Pedidos"]')).toBeNull();
  });

  it('prioritizes onGoToCart from the notification bell and calls it once', async () => {
    const onStart = vi.fn();
    const onGoToCart = vi.fn();
    await renderScreen({ onStart, onGoToCart });

    const bell = container.querySelector('button[title="Notificações"]') as HTMLButtonElement | null;
    expect(bell).toBeTruthy();

    await act(async () => {
      bell!.click();
      await flushAsync();
    });

    expect(onGoToCart).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('falls back to onStart from the notification bell exactly once', async () => {
    const onStart = vi.fn();
    await renderScreen({ onStart });

    const bell = container.querySelector('button[title="Notificações"]') as HTMLButtonElement | null;
    expect(bell).toBeTruthy();

    await act(async () => {
      bell!.click();
      await flushAsync();
    });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('starts the flow exactly once from Selecionar endereço', async () => {
    const onStart = vi.fn();
    await renderScreen({ onStart });

    const addressButton = findButton('Selecionar endereço');
    expect(addressButton).toBeTruthy();

    await act(async () => {
      addressButton!.click();
      await flushAsync();
    });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('does not advertise free shipping without an authoritative active rule', async () => {
    await renderScreen();

    expect(findButton('Frete Grátis')).toBeFalsy();
    expect(container.textContent).not.toContain('R$ 40,00');
  });

  it('uses the authoritative Vision Prime free-shipping minimum and starts exactly once', async () => {
    const onStart = vi.fn();
    useVisionPrimeConfigMock.mockReturnValue({
      config: {
        ativo: true,
        valor_mensalidade: 19.9,
        desconto_percentual: 10,
        frete_gratis_minimo: 73.5,
      },
      loading: false,
    });

    await renderScreen({ onStart });

    const promo = findButton('Frete Grátis');
    expect(promo).toBeTruthy();
    expect(promo!.textContent).toContain('Vision Prime');
    expect(promo!.textContent).toContain('73,50');
    expect(promo!.textContent).not.toContain('R$ 40,00');

    await act(async () => {
      promo!.click();
      await flushAsync();
    });

    expect(onStart).toHaveBeenCalledTimes(1);

    await act(async () => {
      findButton('Favoritos')!.click();
      await flushAsync();
    });

    expect(findButton('Frete Grátis')).toBeFalsy();
  });

  it('describes zero Vision Prime minimum as free shipping on every member order', async () => {
    useVisionPrimeConfigMock.mockReturnValue({
      config: {
        ativo: true,
        valor_mensalidade: 19.9,
        desconto_percentual: 10,
        frete_gratis_minimo: 0,
      },
      loading: false,
    });

    await renderScreen();

    const promo = findButton('Frete Grátis');
    expect(promo).toBeTruthy();
    expect(promo!.textContent).toContain('Vision Prime');
    expect(promo!.textContent).toContain('todos os pedidos');
    expect(promo!.textContent).not.toContain('R$ 40,00');
  });

  it.each([
    ['', '', null, null],
    ['https://www.instagram.com/loja.teste/', '', 'https://www.instagram.com/loja.teste/', null],
    ['', '+55 (62) 99608-1004', null, 'https://wa.me/5562996081004'],
    ['https://instagram.com/loja/', '5562996081004', 'https://instagram.com/loja/', 'https://wa.me/5562996081004'],
  ])('renders only configured social channels (%s, %s)', async (instagram, whatsapp, expectedInstagram, expectedWhatsapp) => {
    fetchPublicStorefrontConfigMock.mockResolvedValue({ instagram_url: instagram, whatsapp_number: whatsapp });
    await renderScreen();
    const ig = container.querySelector('a[aria-label="Abrir Instagram"]');
    const wa = container.querySelector('a[aria-label="Abrir WhatsApp"]');
    expect(ig?.getAttribute('href') ?? null).toBe(expectedInstagram);
    expect(wa?.getAttribute('href') ?? null).toBe(expectedWhatsapp);
    expect(container.textContent?.includes('Siga e fale conosco')).toBe(Boolean(expectedInstagram || expectedWhatsapp));
    for (const link of [ig, wa].filter(Boolean)) {
      expect(link!.getAttribute('target')).toBe('_blank');
      expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it.each([
    ['   ', '   '],
    ['javascript:alert(1)', 'abc'],
    ['/loja', '123'],
    ['https://example.com/loja', '000000000000'],
    ['https://instagram.com.evil.example/loja', 'telefone5562996081004'],
    ['https://instagram.com@evil.example/loja', 'https://wa.me/5562996081004'],
    ['https://evil.example@instagram.com/loja', '1234567890123456'],
    ['https://instagram.com/', '+0 (62) 99608-1004'],
    [42, 5562996081004],
  ])('hides malformed social configuration (%s, %s)', async (instagram, whatsapp) => {
    fetchPublicStorefrontConfigMock.mockResolvedValue({ instagram_url: instagram, whatsapp_number: whatsapp });
    await renderScreen();
    expect(container.querySelector('a[aria-label="Abrir Instagram"]')).toBeNull();
    expect(container.querySelector('a[aria-label="Abrir WhatsApp"]')).toBeNull();
    expect(container.textContent).not.toContain('Siga e fale conosco');
  });

  it.each(['Pedidos', 'Perfil'])('navigates the bottom %s link to /meus-pedidos by click', async (label) => {
    await renderScreen();

    const bottomNav = container.querySelector('nav');
    const link = Array.from(bottomNav?.querySelectorAll('a') || []).find(
      anchor => anchor.textContent?.trim() === label,
    ) as HTMLAnchorElement | undefined;
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/meus-pedidos');

    await act(async () => {
      link!.click();
      await flushAsync();
    });

    expect(container.querySelector('[data-testid="route-probe"]')?.textContent).toBe('/meus-pedidos');
  });

  it('navigates the footer Painel link to /admin by click', async () => {
    await renderScreen();

    const panelLink = Array.from(container.querySelectorAll('a')).find(
      anchor => anchor.textContent?.trim() === 'Painel',
    ) as HTMLAnchorElement | undefined;
    expect(panelLink).toBeTruthy();
    expect(panelLink!.getAttribute('href')).toBe('/admin');

    await act(async () => {
      panelLink!.click();
      await flushAsync();
    });

    expect(container.querySelector('[data-testid="route-probe"]')?.textContent).toBe('/admin');
  });

  it('hides Pedidos, Perfil and Painel in device-owned kiosk while preserving Início, Buscar and Favoritos', async () => {
    await renderScreen({ deviceOwnedKiosk: true });

    const bottomNav = container.querySelector('nav');
    const navText = Array.from(bottomNav?.querySelectorAll('button, a') || []).map(
      element => element.textContent?.trim(),
    );

    expect(navText).toEqual(expect.arrayContaining(['Início', 'Buscar', 'Favoritos']));
    expect(navText).not.toContain('Pedidos');
    expect(navText).not.toContain('Perfil');
    expect(Array.from(container.querySelectorAll('a')).some(anchor => anchor.textContent?.trim() === 'Painel')).toBe(false);
  });

  it('keeps the valid channel when the other is malformed', async () => {
    fetchPublicStorefrontConfigMock.mockResolvedValue({ instagram_url: 'https://example.com', whatsapp_number: '+55 (62) 99608-1004' });
    await renderScreen();
    expect(container.querySelector('a[aria-label="Abrir Instagram"]')).toBeNull();
    const wa = container.querySelector('a[aria-label="Abrir WhatsApp"]')!;
    expect(wa.getAttribute('href')).toBe('https://wa.me/5562996081004');
    expect(wa.parentElement?.className).toContain('grid-cols-1');
  });

});
