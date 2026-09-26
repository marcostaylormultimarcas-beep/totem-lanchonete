// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  onAuthStateChangeMock,
  signOutMock,
  getKioskCompanionStatusMock,
  clearKioskCustomerBrowserStateMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  signOutMock: vi.fn(),
  getKioskCompanionStatusMock: vi.fn(),
  clearKioskCustomerBrowserStateMock: vi.fn(),
}));

vi.mock('@/contexts/OrgContext', () => ({
  useOrgId: () => 'org-a',
}));

vi.mock('@/lib/publicStorefrontConfig', () => ({
  fetchPublicStorefrontConfig: vi.fn().mockResolvedValue({
    delivery_enabled: true,
    share_image: '',
    store_name: 'Loja Teste',
  }),
}));

vi.mock('@/lib/offlineCheckoutQueue', () => ({
  clearPendingCheckout: vi.fn(),
  loadPendingCheckout: () => null,
}));

vi.mock('@/lib/kioskCompanionClient', () => ({
  getKioskCompanionStatus: getKioskCompanionStatusMock,
}));

vi.mock('@/lib/kioskDeviceMode', () => ({
  clearKioskCustomerBrowserState: clearKioskCustomerBrowserStateMock,
  isDeviceOwnedKioskStatus: (status: any, orgId: string) =>
    Boolean(status?.enrolled && status?.organization_id === orgId),
}));

vi.mock('@/lib/kioskPublicDataWarmup', () => ({
  warmKioskPublicData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      signOut: signOutMock,
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

const cartItem = {
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
};

vi.mock('@/components/kiosk/LandingScreen', () => ({
  default: ({ onStart }: any) => <button onClick={onStart}>landing-next</button>,
}));

vi.mock('@/components/kiosk/StartScreen', () => ({
  default: ({ onStart }: any) => <button onClick={onStart}>start-next</button>,
}));

vi.mock('@/components/kiosk/LocationSelect', () => ({
  default: ({ onSelect }: any) => <button onClick={() => onSelect('local')}>location-local</button>,
}));

vi.mock('@/components/kiosk/LocalServiceSelect', () => ({
  default: ({ onBalcony }: any) => <button onClick={onBalcony}>service-balcony</button>,
}));

vi.mock('@/components/kiosk/TableSelect', () => ({ default: () => null }));
vi.mock('@/components/kiosk/AddressSelect', () => ({ default: () => null }));

vi.mock('@/components/kiosk/MenuScreen', () => ({
  default: ({ onAddToCart, onGoToCart }: any) => (
    <button onClick={() => { onAddToCart(cartItem); onGoToCart(); }}>menu-cart</button>
  ),
}));

vi.mock('@/components/kiosk/CartScreen', () => ({
  default: ({ onCheckout }: any) => (
    <button onClick={() => onCheckout('2026-09-26T18:30:00-03:00')}>cart-checkout</button>
  ),
}));

vi.mock('@/components/kiosk/CheckoutScreen', () => ({
  default: ({ onContinue }: any) => <button onClick={onContinue}>checkout-payment</button>,
}));

vi.mock('@/components/kiosk/PaymentScreen', () => ({
  default: ({ onDone }: any) => <button onClick={() => onDone('order-123')}>payment-done</button>,
}));

vi.mock('@/components/kiosk/TotemSuccess', () => ({
  default: ({ orderId, scheduledFor }: any) => (
    <div>totem-success:{orderId}:{scheduledFor}</div>
  ),
}));

vi.mock('@/components/kiosk/NotificationBell', () => ({ default: () => null }));
vi.mock('@/components/kiosk/PartnersFooter', () => ({ default: () => null }));

import Index from '@/pages/Index';

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Index handlePaymentDone scheduled routing', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    sessionStorage.clear();

    onAuthStateChangeMock.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    signOutMock.mockResolvedValue({ error: null });
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });
    getKioskCompanionStatusMock.mockResolvedValue({
      enrolled: false,
      organization_id: null,
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

  it('clears the active checkout and routes web/mobile to /acompanhar/:orderId', async () => {
    sessionStorage.setItem('active-kiosk-order', JSON.stringify({
      organizationId: 'org-a',
      step: 'payment',
      orderType: 'local',
      cart: [cartItem],
      customerName: 'Cliente',
      customerPhone: '62999999999',
      customerCpf: '',
      deliveryAddress: '',
      deliveryReference: '',
      deliveryRecipient: '',
      bairroId: '',
      bairroNome: '',
      bairroTaxa: 0,
      bairroTempo: 0,
      deliveryCep: '',
      tableToken: '',
      tableLabel: '',
      scheduledFor: '2026-09-26T18:30:00-03:00',
    }));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/loja/demo']}>
          <Routes>
            <Route path="/loja/:slug" element={<Index />} />
            <Route path="/acompanhar/:orderId" element={<div>tracking-route</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await flushAsync();
    });

    const done = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'payment-done') as HTMLButtonElement | undefined;
    expect(done).toBeTruthy();

    await act(async () => {
      done!.click();
      await flushAsync();
    });

    expect(container.textContent).toContain('tracking-route');
    expect(sessionStorage.getItem('active-kiosk-order')).toBeNull();
  });

  it('sends a device-owned scheduled order to TotemSuccess instead of web tracking', async () => {
    getKioskCompanionStatusMock.mockResolvedValue({
      enrolled: true,
      organization_id: 'org-a',
    });
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/cardapio/demo']}>
          <Routes>
            <Route path="/cardapio/:slug" element={<Index />} />
            <Route path="/acompanhar/:orderId" element={<div>wrong-web-route</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await flushAsync();
    });

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button'))
        .find(entry => entry.textContent === label) as HTMLButtonElement | undefined;
      expect(button).toBeTruthy();
      await act(async () => {
        button!.click();
        await flushAsync();
      });
    };

    await click('landing-next');
    await click('start-next');
    await click('location-local');
    await click('service-balcony');
    await click('menu-cart');
    await click('cart-checkout');
    await click('checkout-payment');
    await click('payment-done');

    expect(container.textContent).toContain(
      'totem-success:order-123:2026-09-26T18:30:00-03:00',
    );
    expect(container.textContent).not.toContain('wrong-web-route');
    expect(sessionStorage.getItem('active-kiosk-order')).toBeNull();
    expect(clearKioskCustomerBrowserStateMock).toHaveBeenCalled();
  });
});
