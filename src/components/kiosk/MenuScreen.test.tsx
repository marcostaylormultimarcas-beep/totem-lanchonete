// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/OrgContext', () => ({
  useOrgId: () => null,
}));

vi.mock('@/lib/publicStorefrontConfig', () => ({
  fetchPublicStorefrontConfig: vi.fn(),
}));

vi.mock('@/lib/publicCatalog', () => ({
  fetchPublicCatalog: vi.fn(),
}));

vi.mock('@/lib/publicCombo', () => ({
  fetchPublicCombo: vi.fn(),
}));

vi.mock('@/components/kiosk/ProductModal', () => ({
  default: () => null,
}));

vi.mock('@/components/kiosk/UpsellPopup', () => ({
  default: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

import MenuScreen from '@/components/kiosk/MenuScreen';
import type { CartItem, Product } from '@/data/store';

const WEIGHT_PRODUCT: Product = {
  id: 'prod-weight',
  name: 'Self-service',
  price: 20,
  category: 'refeicoes',
  image: '',
  removableIngredients: [],
  extras: [{ name: 'Embalagem premium', price: 4 }],
  soldByWeight: true,
};

const UNIT_PRODUCT: Product = {
  id: 'prod-unit',
  name: 'Suco',
  price: 10,
  category: 'bebidas',
  image: '',
  removableIngredients: [],
  extras: [],
  soldByWeight: false,
};

const WEIGHT_ITEM: CartItem = {
  id: 'weight-item',
  product: WEIGHT_PRODUCT,
  quantity: 1,
  removedIngredients: [],
  selectedExtras: [{ name: 'Embalagem premium', price: 4 }],
  weightKg: 0.75,
};

const UNIT_ITEM: CartItem = {
  id: 'unit-item',
  product: UNIT_PRODUCT,
  quantity: 2,
  removedIngredients: [],
  selectedExtras: [],
};

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('MenuScreen desktop cart weighted items', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (container?.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.clearAllMocks();
  });

  it('shows kg for weighted items while preserving quantity for unit items and the mixed total', async () => {
    await act(async () => {
      root.render(
        <MenuScreen
          cart={[WEIGHT_ITEM, UNIT_ITEM]}
          onAddToCart={vi.fn()}
          onGoToCart={vi.fn()}
          onBack={vi.fn()}
          deviceOwnedKiosk
        />,
      );
      await flushAsync();
    });

    const text = (container.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');

    expect(text).toContain('0.750 kg Self-service');
    expect(text).not.toContain('1x Self-service');
    expect(text).toContain('2x Suco');
    expect(text).toContain('R$ 38,00');
  });
});
