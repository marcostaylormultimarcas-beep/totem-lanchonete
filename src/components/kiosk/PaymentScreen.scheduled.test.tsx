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
  createClientRequestId: () => 'request-1',
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

const cart = [{
  id: 'cart-1',
  product: {
    id: 'prod-1',
    name: 'X-Burger',
    price: 20,
    category: 'lanches',
    image: '',
    removable_ingredients: [],
    extras: [],
    is_combo: false,
    ingredients: [],
    description: '',
    prep_time_min: 10,
  },
  quantity: 1,
  removedIngredients: [],
  selectedExtras: [],
}];

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('PaymentScreen scheduled post-confirmation', () => {
  let root: Root;
  let container: HTMLDivElement;

  const renderScreen = async (onDone = vi.fn()) => {
    await act(async () => {
      root.render(
        <PaymentScreen
          cart={cart as any}
          customerName="Cliente"
          customerPhone="62999999999"
          orderType="local"
          scheduledFor="2026-09-26T18:30:00-03:00"
          onBack={vi.fn()}
          onDone={onDone}
        />,
      );
      await flushAsync();
    });
    return onDone;
  };

  const findButton = (text: string) =>
    Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes(text),
    ) as HTMLButtonElement | undefined;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();

    fetchPaymentConfigMock.mockResolvedValue({
      store_name: 'Loja Teste',
      whatsapp_number: '',
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
            subtotal: 20,
            coupon_discount: 0,
            prime_discount: 0,
            discount: 0,
            delivery_fee: 0,
            total: 20,
            prime_shipping_waived: false,
          },
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

  it('submits only once when confirmation is activated twice in the same turn', async () => {
    let resolveCheckout!: (value: any) => void;
    const checkoutPromise = new Promise(resolve => {
      resolveCheckout = resolve;
    });

    rpcMock.mockImplementation((name: string) => {
      if (name === 'quote_order_checkout_v2') {
        return Promise.resolve({
          data: {
            subtotal: 20,
            coupon_discount: 0,
            prime_discount: 0,
            discount: 0,
            delivery_fee: 0,
            total: 20,
            prime_shipping_waived: false,
          },
          error: null,
        });
      }
      if (name === 'create_order_checkout_v4') return checkoutPromise;
      if (name === 'parceria_generate_for_order') {
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderScreen();

    await act(async () => {
      findButton('Dinheiro no Balcão')!.click();
      await flushAsync();
    });

    const confirmButton = findButton('Confirmar Pedido');
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton!.click();
      confirmButton!.click();
      await Promise.resolve();
    });

    const checkoutCalls = rpcMock.mock.calls.filter(([name]) => name === 'create_order_checkout_v4');
    expect(checkoutCalls).toHaveLength(1);

    resolveCheckout({
      data: [{ id: 'order-1', order_number: '77', delivery_code: '' }],
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });
  });

  it('shows the scheduled confirmation and forwards its authoritative order id only once', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'quote_order_checkout_v2') {
        return Promise.resolve({
          data: {
            subtotal: 20,
            coupon_discount: 0,
            prime_discount: 0,
            discount: 0,
            delivery_fee: 0,
            total: 20,
            prime_shipping_waived: false,
          },
          error: null,
        });
      }
      if (name === 'create_order_checkout_v4') {
        return Promise.resolve({
          data: [{ id: 'order-1', order_number: '77', delivery_code: '' }],
          error: null,
        });
      }
      if (name === 'parceria_generate_for_order') {
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    const onDone = await renderScreen(vi.fn());

    await act(async () => {
      findButton('Dinheiro no Balcão')!.click();
      await flushAsync();
    });

    await act(async () => {
      findButton('Confirmar Pedido')!.click();
      await flushAsync();
    });

    expect(container.textContent).toContain('Pedido Agendado!');
    expect(container.textContent).toContain('Data e horário agendados');

    const trackingButton = findButton('Acompanhar Pedido Agendado');
    expect(trackingButton).toBeTruthy();

    await act(async () => {
      trackingButton!.click();
      trackingButton!.click();
      await Promise.resolve();
    });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('order-1');
  });
});
