// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/kiosk/LoyaltyCard', () => ({
  default: () => null,
}));

vi.mock('@/hooks/useVisionPrime', () => ({
  useVisionPrimeConfig: () => ({ config: null }),
  useVisionPrimeStatus: () => ({ status: { active: false, sinceYear: null } }),
}));

vi.mock('@/hooks/useStoreStatus', () => ({
  getSpecialClosure: vi.fn(),
  useStoreStatus: () => ({
    loading: false,
    open: true,
    message: '',
    nextOpenAt: null,
    emergencyClosed: false,
    schedulingEnabled: false,
    schedulingSlotMinutes: 30,
    schedulingCapacityEnabled: false,
    schedulingMaxOrdersPerSlot: 0,
    specialClosures: [],
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

import CartScreen from '@/components/kiosk/CartScreen';
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

describe('CartScreen weighted items', () => {
  let root: Root;
  let container: HTMLDivElement;

  const renderCart = async (cart: CartItem[], onRemove = vi.fn()) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/loja/demo']}>
          <CartScreen
            cart={cart}
            onRemove={onRemove}
            onCheckout={vi.fn()}
            onBack={vi.fn()}
            orgId="org-a"
            appliedCoupon={null}
            onApplyCoupon={vi.fn()}
            deviceOwnedKiosk
          />
        </MemoryRouter>,
      );
      await flushAsync();
    });
    return onRemove;
  };

  const normalizedText = (element: Element | null) =>
    (element?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (container?.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('renders weight instead of quantity and keeps line/subtotal math authoritative', async () => {
    await renderCart([WEIGHT_ITEM, UNIT_ITEM]);

    const headings = Array.from(container.querySelectorAll('h4')).map(normalizedText);
    expect(headings).toContain('0.750 kg Self-service');
    expect(headings).not.toContain('1x Self-service');
    expect(headings).toContain('2x Suco');

    const weightedCard = Array.from(container.querySelectorAll('.kiosk-card')).find(card =>
      normalizedText(card).includes('Self-service'),
    );
    expect(normalizedText(weightedCard || null)).toContain('+Embalagem premium');
    expect(normalizedText(weightedCard || null)).toContain('R$ 18,00');

    const subtotalLabel = Array.from(container.querySelectorAll('span')).find(
      span => normalizedText(span) === 'Subtotal',
    );
    expect(normalizedText(subtotalLabel?.parentElement || null)).toBe('Subtotal R$ 38,00');
  });

  it('removes a weighted item by id without rewriting its weight or quantity', async () => {
    const onRemove = await renderCart([WEIGHT_ITEM]);

    const trash = Array.from(container.querySelectorAll('button')).find(button =>
      button.className.includes('text-destructive') && Boolean(button.querySelector('svg')),
    ) as HTMLButtonElement | undefined;
    expect(trash).toBeTruthy();

    await act(async () => {
      trash!.click();
      await flushAsync();
    });

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('weight-item');
    expect(WEIGHT_ITEM.quantity).toBe(1);
    expect(WEIGHT_ITEM.weightKg).toBe(0.75);
  });
});
