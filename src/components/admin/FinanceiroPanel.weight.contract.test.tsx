// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: fromMock,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import FinanceiroPanel from '@/components/admin/FinanceiroPanel';

type TableData = Record<string, unknown>;
let tableData: TableData;

function resolvedQuery(payload: unknown) {
  const promise = Promise.resolve(payload);
  const q: any = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    gte: vi.fn(() => q),
    lte: vi.fn(() => q),
    order: vi.fn(() => q),
    neq: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(payload)),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return q;
}

function financeRow(orderId: string) {
  return {
    order_id: orderId,
    order_number: orderId,
    created_at: '2026-09-27T02:00:00.000Z',
    payment_method: 'pix',
    customer_name: 'Cliente',
    valor_bruto: 100,
    taxa_gateway_valor: 0,
    taxa_vision_valor: 0,
    valor_liquido_final: 100,
  };
}

function recipe(productId: string, ingredientId: string, quantity: number) {
  return {
    product_id: productId,
    produto_id: null,
    ingredient_id: ingredientId,
    ingrediente_id: ingredientId,
    quantidade: quantity,
  };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('FinanceiroPanel weighted recipe CMV contract', () => {
  let root: Root;
  let container: HTMLDivElement;

  function summaryValue(label: string) {
    const labelNode = Array.from(container.querySelectorAll('span'))
      .find(node => node.textContent?.trim() === label);
    const card = labelNode?.parentElement?.parentElement;
    return (card?.querySelector('.mt-2')?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  async function renderPanel() {
    await act(async () => {
      root.render(<FinanceiroPanel organizationId="org-a" />);
      await flushAsync();
    });
  }

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();

    tableData = {
      v_financeiro_detalhado: [],
      settings: { taxa_vision_percent: 0 },
      orders: [],
      receitas: [],
      ingredientes: [],
      products: [],
    };

    fromMock.mockImplementation((table: string) => {
      return resolvedQuery({ data: tableData[table] ?? [], error: null });
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.restoreAllMocks();
  });

  it('keeps unit products multiplying complete recipe cost by quantity', async () => {
    tableData.v_financeiro_detalhado = [financeRow('unit-2')];
    tableData.orders = [{
      id: 'unit-2',
      status: 'paid',
      items: [{ product_id: 'prod-unit', quantity: 2 }],
    }];
    tableData.receitas = [recipe('prod-unit', 'ing-unit', 4)];
    tableData.ingredientes = [{ id: 'ing-unit', custo_unitario: 5 }];
    tableData.products = [{ id: 'prod-unit', cost_price: 99, sold_by_weight: false }];

    await renderPanel();

    expect(summaryValue('CMV estimado')).toBe('R$ 40,00');
  });

  it('uses weight_kg as multiplier for a sold_by_weight product with complete recipe even without cost_price', async () => {
    tableData.v_financeiro_detalhado = [financeRow('weight-recipe')];
    tableData.orders = [{
      id: 'weight-recipe',
      status: 'paid',
      items: [{ product_id: 'prod-weight', quantity: 1, weight_kg: 0.75, sold_by_weight: true }],
    }];
    tableData.receitas = [recipe('prod-weight', 'ing-weight', 4)];
    tableData.ingredientes = [{ id: 'ing-weight', custo_unitario: 5 }];
    tableData.products = [{ id: 'prod-weight', cost_price: null, sold_by_weight: true }];

    await renderPanel();

    expect(summaryValue('CMV estimado')).toBe('R$ 15,00');
  });

  it('keeps cost_price fallback for an incomplete weighted recipe and scales fallback by weight_kg', async () => {
    tableData.v_financeiro_detalhado = [financeRow('weight-fallback')];
    tableData.orders = [{
      id: 'weight-fallback',
      status: 'paid',
      items: [{ product_id: 'prod-weight', quantity: 1, weight_kg: 0.5, sold_by_weight: true }],
    }];
    tableData.receitas = [recipe('prod-weight', 'missing-cost', 3)];
    tableData.ingredientes = [];
    tableData.products = [{ id: 'prod-weight', cost_price: 40, sold_by_weight: true }];

    await renderPanel();

    expect(summaryValue('CMV estimado')).toBe('R$ 20,00');
  });

  it('aggregates mixed unit and weighted recipe CMV correctly', async () => {
    tableData.v_financeiro_detalhado = [financeRow('mixed')];
    tableData.orders = [{
      id: 'mixed',
      status: 'paid',
      items: [
        { product_id: 'prod-unit', quantity: 2 },
        { product_id: 'prod-weight', quantity: 1, weight_kg: 0.75, sold_by_weight: true },
      ],
    }];
    tableData.receitas = [
      recipe('prod-unit', 'ing-unit', 2),
      recipe('prod-weight', 'ing-weight', 4),
    ];
    tableData.ingredientes = [
      { id: 'ing-unit', custo_unitario: 5 },
      { id: 'ing-weight', custo_unitario: 5 },
    ];
    tableData.products = [
      { id: 'prod-unit', cost_price: 99, sold_by_weight: false },
      { id: 'prod-weight', cost_price: null, sold_by_weight: true },
    ];

    await renderPanel();

    // unit: 2 × (2 × 5) = 20; weighted: 0.75 × (4 × 5) = 15.
    expect(summaryValue('CMV estimado')).toBe('R$ 35,00');
  });

  it('uses each weighted line weight_kg independently across multiple weighted sales', async () => {
    tableData.v_financeiro_detalhado = [financeRow('multi-weight')];
    tableData.orders = [{
      id: 'multi-weight',
      status: 'paid',
      items: [
        { product_id: 'prod-weight', quantity: 1, weight_kg: 0.25, sold_by_weight: true },
        { product_id: 'prod-weight', quantity: 1, weight_kg: 0.75, sold_by_weight: true },
      ],
    }];
    tableData.receitas = [recipe('prod-weight', 'ing-weight', 4)];
    tableData.ingredientes = [{ id: 'ing-weight', custo_unitario: 5 }];
    tableData.products = [{ id: 'prod-weight', cost_price: null, sold_by_weight: true }];

    await renderPanel();

    expect(summaryValue('CMV estimado')).toBe('R$ 20,00');
  });

  it('fails closed when a sold_by_weight item has no valid weight instead of inventing quantity=1 as one kilogram', async () => {
    tableData.v_financeiro_detalhado = [financeRow('weight-missing')];
    tableData.orders = [{
      id: 'weight-missing',
      status: 'paid',
      items: [{ product_id: 'prod-weight', quantity: 1, sold_by_weight: true }],
    }];
    tableData.receitas = [recipe('prod-weight', 'ing-weight', 4)];
    tableData.ingredientes = [{ id: 'ing-weight', custo_unitario: 5 }];
    tableData.products = [{ id: 'prod-weight', cost_price: 40, sold_by_weight: true }];

    await renderPanel();

    expect(summaryValue('CMV estimado')).toBe('Incompleto');
  });
});
