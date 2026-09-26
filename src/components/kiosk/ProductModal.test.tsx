// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  randomUUIDMock,
  useBalancaMock,
} = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  useBalancaMock: vi.fn(),
}));

vi.mock('@/contexts/OrgContext', () => ({
  useOrgId: () => null,
}));

vi.mock('@/lib/publicStorefrontConfig', () => ({
  fetchPublicStorefrontConfig: vi.fn(),
}));

vi.mock('@/hooks/useBalanca', () => ({
  useBalanca: useBalancaMock,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    rpc: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import ProductModal from '@/components/kiosk/ProductModal';
import type { Product } from '@/data/store';

const PRODUCT: Product = {
  id: 'prod-a',
  name: 'Hambúrguer teste',
  price: 10,
  category: 'hamburgueres',
  image: '',
  removableIngredients: ['Cebola', 'Tomate'],
  extras: [
    { name: 'Bacon', price: 2.5 },
    { name: 'Queijo', price: 3 },
  ],
  ingredients: ['Pão', 'Carne', 'Cebola', 'Tomate'],
  description: 'Produto de teste',
  prepTimeMin: 5,
  soldByWeight: false,
};

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ProductModal non-weight personalization and add flow', () => {
  let root: Root;
  let container: HTMLDivElement;

  const renderModal = async (onAdd = vi.fn()) => {
    await act(async () => {
      root.render(
        <ProductModal
          product={PRODUCT}
          onAdd={onAdd}
          onClose={vi.fn()}
          deviceOwnedKiosk
        />,
      );
      await flushAsync();
    });
    return onAdd;
  };

  const findButton = (text: string) =>
    Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes(text),
    ) as HTMLButtonElement | undefined;

  const quantityButton = (kind: 'plus' | 'minus') =>
    Array.from(container.querySelectorAll('button')).find(button =>
      Boolean(button.querySelector(`svg.lucide-${kind}`)),
    ) as HTMLButtonElement | undefined;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();

    randomUUIDMock.mockReturnValue('local-cart-item-id');
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: randomUUIDMock,
    });

    useBalancaMock.mockReturnValue({
      pesoAtual: 0,
      balancaConectada: false,
      supported: true,
      error: null,
      conectarBalanca: vi.fn(),
      desconectarBalanca: vi.fn(),
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
    vi.restoreAllMocks();
  });

  it('tracks removed ingredients and selected extras in the onAdd payload', async () => {
    const onAdd = await renderModal();

    await act(async () => {
      findButton('Sem Cebola')!.click();
      findButton('Bacon')!.click();
      await flushAsync();
    });

    expect(findButton('Sem Cebola')!.className).toContain('border-red-500');
    expect(findButton('Bacon')!.className).toContain('border-orange-500');
    expect(findButton('Adicionar ao carrinho')!.textContent).toContain('12,50');

    await act(async () => {
      findButton('Adicionar ao carrinho')!.click();
      await flushAsync();
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({
      id: 'local-cart-item-id',
      product: PRODUCT,
      quantity: 1,
      removedIngredients: ['Cebola'],
      selectedExtras: [{ name: 'Bacon', price: 2.5 }],
      weightKg: undefined,
    });
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
  });

  it('recalculates extras by quantity and keeps the minus control at the minimum quantity of one', async () => {
    await renderModal();

    await act(async () => {
      findButton('Bacon')!.click();
      quantityButton('plus')!.click();
      await flushAsync();
    });
    expect(findButton('Adicionar ao carrinho')!.textContent).toContain('25,00');

    await act(async () => {
      quantityButton('minus')!.click();
      quantityButton('minus')!.click();
      await flushAsync();
    });

    expect(findButton('Adicionar ao carrinho')!.textContent).toContain('12,50');
    expect(container.textContent).toContain('Quantidade');
    const quantityValue = Array.from(container.querySelectorAll('span')).find(
      span => span.textContent === '1' && span.className.includes('tabular-nums'),
    );
    expect(quantityValue).toBeTruthy();
  });

  it('toggles an extra off without leaving its price or payload behind', async () => {
    const onAdd = await renderModal();

    await act(async () => {
      findButton('Bacon')!.click();
      findButton('Bacon')!.click();
      await flushAsync();
    });

    expect(findButton('Adicionar ao carrinho')!.textContent).toContain('10,00');

    await act(async () => {
      findButton('Adicionar ao carrinho')!.click();
      await flushAsync();
    });

    expect(onAdd.mock.calls[0][0].selectedExtras).toEqual([]);
  });

  it('accepts one deliberate add click and generates one local cart id', async () => {
    const onAdd = await renderModal();

    await act(async () => {
      findButton('Adicionar ao carrinho')!.click();
      await flushAsync();
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].id).toBe('local-cart-item-id');
  });

  it('does not duplicate the cart item when the add CTA is activated twice immediately', async () => {
    const onAdd = await renderModal();

    await act(async () => {
      const add = findButton('Adicionar ao carrinho')!;
      add.click();
      add.click();
      await flushAsync();
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
  });
});
