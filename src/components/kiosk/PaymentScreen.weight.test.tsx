// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rpcMock,
  fetchPaymentConfigMock,
  savePendingCheckoutMock,
  clearPendingCheckoutMock,
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fetchPaymentConfigMock: vi.fn(),
  savePendingCheckoutMock: vi.fn(),
  clearPendingCheckoutMock: vi.fn(),
}));

vi.mock('@/contexts/OrgContext', () => ({
  useOrgId: () => 'org-a',
}));

vi.mock('@/lib/demoMode', () => ({
  isDemoMode: () => false,
}));

vi.mock('@/lib/offlineCheckoutQueue', () => ({
  canQueueOffline: () => true,
  clearPendingCheckout: clearPendingCheckoutMock,
  createClientRequestId: () => 'request-weight-1',
  loadPendingCheckout: () => null,
  savePendingCheckout: savePendingCheckoutMock,
}));

vi.mock('@/hooks/useVisionPrime', () => ({
  useVisionPrimeConfig: () => ({
    config: { ativo: false, desconto_percentual: 0, frete_gratis_minimo: 0 },
  }),
  useVisionPrimeStatus: () => ({ status: { active: false } }),
}));

vi.mock('@/lib/kioskCompanionClient', () => ({
  enqueueOfflineOrderOnCompanion: vi.fn(),
  getKioskCompanionQueue: vi.fn(),
  syncKioskCompanionQueueOnce: vi.fn(),
}));

vi.mock('@/lib/publicCheckoutPaymentConfig', () => ({
  fetchPublicCheckoutPaymentConfig: fetchPaymentConfigMock,
}));

vi.mock('@/lib/checkoutQuoteReadiness', () => ({
  isCheckoutQuoteReady: () => true,
}));

vi.mock('@/hooks/useStoreStatus', () => ({
  computeStatus: () => ({ nextOpenAt: null }),
  getSpecialClosure: () => null,
  localDateKey: (value: Date) => value.toISOString().slice(0, 10),
  useStoreStatus: () => ({
    hours: [],
    specialClosures: [],
    specialClosureReason: '',
    nextOpenAt: null,
    schedulingEnabled: true,
  }),
}));

vi.mock('@/lib/deliveryRouting', () => ({
  MAX_EXACT_DESTINATION_ACCURACY_M: 100,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import PaymentScreen from '@/components/kiosk/PaymentScreen';

const weightedCart = [
  {
    id: 'weighted-1',
    product: {
      id: 'prod-weight',
      name: 'Self-service',
      price: 40,
      category: 'refeicoes',
      image: '',
      removable_ingredients: [],
      extras: [],
      is_combo: false,
      ingredients: [],
      description: '',
      prep_time_min: 10,
    },
    quantity: 1,
    weightKg: 0.75,
    removedIngredients: [],
    selectedExtras: [{ id: 'extra-1', name: 'Molho', price: 4 }],
  },
  {
    id: 'unit-1',
    product: {
      id: 'prod-unit',
      name: 'Refrigerante',
      price: 10,
      category: 'bebidas',
      image: '',
      removable_ingredients: [],
      extras: [],
      is_combo: false,
      ingredients: [],
      description: '',
      prep_time_min: 0,
    },
    quantity: 2,
    removedIngredients: [],
    selectedExtras: [],
  },
];

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('PaymentScreen weighted items', () => {
  let root: Root;
  let container: HTMLDivElement;

  const findButton = (text: string) =>
    Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes(text),
    ) as HTMLButtonElement | undefined;

  const renderScreen = async () => {
    await act(async () => {
      root.render(
        <PaymentScreen
          cart={weightedCart as any}
          customerName="Cliente Peso"
          customerPhone="62999999999"
          orderType="local"
          onBack={vi.fn()}
          onDone={vi.fn()}
        />,
      );
      await flushAsync();
    });
  };

  const confirmCashOrder = async () => {
    const cashChoice = findButton('Dinheiro no Balcão');
    if (cashChoice) {
      await act(async () => {
        cashChoice.click();
        await flushAsync();
      });
    }

    const confirmButton = findButton('Confirmar Pedido');
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton!.click();
      await flushAsync();
    });
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();

    fetchPaymentConfigMock.mockResolvedValue({
      store_name: 'Loja Peso',
      whatsapp_number: '5562999999999',
      pix_key_manual: '',
      pay_cash_enabled: true,
      pay_pix_enabled: false,
      pay_card_terminal_enabled: false,
      pay_card_online_enabled: false,
      mp_terminal_id: '',
    });

    rpcMock.mockImplementation((name: string) => {
      if (name === 'quote_order_checkout_v2') {
        return Promise.resolve({
          data: {
            subtotal: 53,
            coupon_discount: 0,
            prime_discount: 0,
            discount: 0,
            delivery_fee: 0,
            total: 53,
            prime_shipping_waived: false,
          },
          error: null,
        });
      }
      if (name === 'create_order_checkout_v4') {
        return Promise.resolve({
          data: [{ id: 'order-weight-1', order_number: '88', delivery_code: '' }],
          error: null,
        });
      }
      if (name === 'parceria_generate_for_order') {
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`Unexpected RPC: ${name}`);
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

  it('preserves weight in quote/order payloads and mixed weighted/unit totals', async () => {
    await renderScreen();

    const quoteCalls = rpcMock.mock.calls.filter(([name]) => name === 'quote_order_checkout_v2');
    expect(quoteCalls.length).toBeGreaterThan(0);
    expect(quoteCalls[0][1]._items).toEqual([
      {
        product_id: 'prod-weight',
        quantity: 1,
        extras: ['Molho'],
        weight_kg: 0.75,
        removedIngredients: [],
      },
      {
        product_id: 'prod-unit',
        quantity: 2,
        extras: [],
        weight_kg: null,
        removedIngredients: [],
      },
    ]);

    expect(container.textContent).toContain('R$ 53,00');

    await confirmCashOrder();

    const checkoutCalls = rpcMock.mock.calls.filter(([name]) => name === 'create_order_checkout_v4');
    expect(checkoutCalls).toHaveLength(1);
    expect(checkoutCalls[0][1]._items).toEqual([
      {
        product_id: 'prod-weight',
        name: 'Self-service',
        quantity: 1,
        price: 40,
        total: 33,
        removedIngredients: [],
        extras: ['Molho'],
        weight_kg: 0.75,
        price_per_kg: 40,
        sold_by_weight: true,
      },
      {
        product_id: 'prod-unit',
        name: 'Refrigerante',
        quantity: 2,
        price: 10,
        total: 20,
        removedIngredients: [],
        extras: [],
        weight_kg: null,
        price_per_kg: null,
        sold_by_weight: false,
      },
    ]);
  });

  it('shows kg instead of 1x in confirmed summary and WhatsApp while preserving line totals', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await renderScreen();
    await confirmCashOrder();

    expect(container.textContent).toContain('0.750 kg Self-service');
    expect(container.textContent).not.toContain('1x Self-service');
    expect(container.textContent).toContain('2x Refrigerante');

    const shareButton = findButton('Compartilhar pedido no WhatsApp');
    expect(shareButton).toBeTruthy();

    await act(async () => {
      shareButton!.click();
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledTimes(1);
    const whatsappUrl = String(openSpy.mock.calls[0][0]);
    const message = new URL(whatsappUrl).searchParams.get('text') || '';

    expect(message).toContain('0.750 kg Self-service — R$ 33,00');
    expect(message).not.toContain('1x Self-service');
    expect(message).toContain('2x Refrigerante — R$ 20,00');
    expect(message).toContain('Molho (+R$ 4,00)');
  });
});
