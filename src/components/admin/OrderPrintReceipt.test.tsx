// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/store', () => ({
  formatCurrency: (value: number) => `R$ ${Number(value).toFixed(2)}`,
}));

import OrderPrintReceipt from '@/components/admin/OrderPrintReceipt';

describe('OrderPrintReceipt weighted items', () => {
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
    vi.restoreAllMocks();
  });

  it('shows kg for weighted items while preserving unit labels, authoritative totals, details, scheduling and order type', async () => {
    const order = {
      order_number: '77',
      created_at: '2026-09-26T12:00:00.000Z',
      scheduled_for: '2026-09-27T15:30:00.000Z',
      customer_name: 'Cliente Teste',
      customer_phone: '62999999999',
      order_type: 'delivery',
      delivery_address: 'Rua Teste, 123',
      payment_method: 'pix',
      total: 56.72,
      items: [
        {
          quantity: 1,
          weight_kg: 0.75,
          name: 'Self-service',
          price: 39.9,
          total: 31.17,
          removedIngredients: ['Cebola'],
          extras: ['Bacon'],
          notes: 'Sem gelo',
        },
        {
          quantity: 2,
          name: 'Refrigerante',
          price: 11.21,
          total: 25.55,
          observation: 'Bem gelado',
        },
      ],
    };

    await act(async () => {
      root.render(
        <OrderPrintReceipt
          order={order}
          storeName="Loja Teste"
          formatClass="print-a4"
        />,
      );
    });

    const text = document.body.textContent || '';

    expect(text).toContain('0.750 kg Self-service');
    expect(text).toContain('2x Refrigerante');
    expect(text).not.toContain('1x Self-service');

    expect(text).toContain('R$ 31.17');
    expect(text).toContain('R$ 25.55');
    expect(text).toContain('SubtotalR$ 56.72');

    expect(text).toContain('Obs: Sem: Cebola | Add: Bacon | Sem gelo');
    expect(text).toContain('Obs: Bem gelado');
    expect(text).toContain('AGENDADO:');
    expect(text).toContain('Tipo: DELIVERY');
    expect(text).toContain('Endereço: Rua Teste, 123');
    expect(document.querySelector('#print-receipt-area')?.className).toContain('print-a4');
  });
});
