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

const WEIGHT_PRODUCT: Product = {
  id: 'prod-weight',
  name: 'Self-service',
  price: 20,
  category: 'refeicoes',
  image: '',
  removableIngredients: [],
  extras: [
    { name: 'Embalagem premium', price: 4 },
  ],
  ingredients: [],
  description: 'Produto vendido por peso',
  prepTimeMin: 0,
  soldByWeight: true,
};

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ProductModal non-weight personalization and add flow', () => {
  let root: Root;
  let container: HTMLDivElement;

  const renderModal = async (onAdd = vi.fn(), product: Product = PRODUCT) => {
    await act(async () => {
      root.render(
        <ProductModal
          product={product}
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

  const addButton = () =>
    Array.from(container.querySelectorAll('button')).find(button =>
      Boolean(button.querySelector('svg.lucide-shopping-cart')),
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
      status: 'idle',
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

  it('detects a sold-by-weight product and renders the scale flow instead of quantity controls', async () => {
    await renderModal(vi.fn(), WEIGHT_PRODUCT);

    expect(container.textContent).toContain('/ kg');
    expect(container.textContent).toContain('Peso na Balança');
    expect(container.textContent).not.toContain('Quantidade');
  });

  it('routes the balance control to connect when idle and disconnect when connected', async () => {
    const conectarBalanca = vi.fn();
    const desconectarBalanca = vi.fn();
    const onAdd = vi.fn();

    useBalancaMock.mockReturnValue({
      pesoAtual: 0,
      balancaConectada: false,
      status: 'idle',
      supported: true,
      error: null,
      conectarBalanca,
      desconectarBalanca,
    });

    await renderModal(onAdd, WEIGHT_PRODUCT);

    await act(async () => {
      findButton('Conectar')!.click();
      await flushAsync();
    });
    expect(conectarBalanca).toHaveBeenCalledTimes(1);

    useBalancaMock.mockReturnValue({
      pesoAtual: 0,
      balancaConectada: true,
      status: 'connected',
      supported: true,
      error: null,
      conectarBalanca,
      desconectarBalanca,
    });

    await act(async () => {
      root.render(
        <ProductModal
          product={WEIGHT_PRODUCT}
          onAdd={onAdd}
          onClose={vi.fn()}
          deviceOwnedKiosk
        />,
      );
      await flushAsync();
    });

    await act(async () => {
      findButton('Conectada')!.click();
      await flushAsync();
    });
    expect(desconectarBalanca).toHaveBeenCalledTimes(1);
  });

  it('blocks the add CTA when the connected scale reports zero weight', async () => {
    useBalancaMock.mockReturnValue({
      pesoAtual: 0,
      balancaConectada: true,
      status: 'connected',
      supported: true,
      error: null,
      conectarBalanca: vi.fn(),
      desconectarBalanca: vi.fn(),
    });

    const onAdd = await renderModal(vi.fn(), WEIGHT_PRODUCT);

    expect(addButton()!.disabled).toBe(true);
    expect(addButton()!.textContent).toContain('Coloque na balança');

    await act(async () => {
      addButton()!.click();
      await flushAsync();
    });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('calculates price per kg with extras and sends quantity one plus the measured weight', async () => {
    useBalancaMock.mockReturnValue({
      pesoAtual: 0.75,
      balancaConectada: true,
      status: 'connected',
      supported: true,
      error: null,
      conectarBalanca: vi.fn(),
      desconectarBalanca: vi.fn(),
    });

    const onAdd = await renderModal(vi.fn(), WEIGHT_PRODUCT);

    await act(async () => {
      findButton('Embalagem premium')!.click();
      await flushAsync();
    });

    expect(addButton()!.textContent).toContain('18,00');

    await act(async () => {
      addButton()!.click();
      await flushAsync();
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({
      id: 'local-cart-item-id',
      product: WEIGHT_PRODUCT,
      quantity: 1,
      removedIngredients: [],
      selectedExtras: [{ name: 'Embalagem premium', price: 4 }],
      weightKg: 0.75,
    });
  });

  it('does not duplicate a weighted cart item on two immediate add activations', async () => {
    useBalancaMock.mockReturnValue({
      pesoAtual: 0.75,
      balancaConectada: true,
      status: 'connected',
      supported: true,
      error: null,
      conectarBalanca: vi.fn(),
      desconectarBalanca: vi.fn(),
    });

    const onAdd = await renderModal(vi.fn(), WEIGHT_PRODUCT);

    await act(async () => {
      addButton()!.click();
      addButton()!.click();
      await flushAsync();
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
  });

  it('does not accept a stale measured weight after the scale is disconnected', async () => {
    useBalancaMock.mockReturnValue({
      pesoAtual: 0.75,
      balancaConectada: false,
      status: 'idle',
      supported: true,
      error: null,
      conectarBalanca: vi.fn(),
      desconectarBalanca: vi.fn(),
    });

    const onAdd = await renderModal(vi.fn(), WEIGHT_PRODUCT);

    expect(addButton()!.disabled).toBe(true);

    await act(async () => {
      addButton()!.click();
      await flushAsync();
    });
    expect(onAdd).not.toHaveBeenCalled();
  });

});
