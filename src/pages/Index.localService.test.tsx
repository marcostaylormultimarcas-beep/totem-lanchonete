// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  onAuthStateChangeMock,
  rpcMock,
  getKioskCompanionStatusMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  rpcMock: vi.fn(),
  getKioskCompanionStatusMock: vi.fn(),
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
  clearKioskCustomerBrowserState: vi.fn(),
  isDeviceOwnedKioskStatus: () => false,
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
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: rpcMock,
  },
}));

vi.mock('@/components/kiosk/LandingScreen', () => ({
  default: ({ onStart }: any) => <button onClick={onStart}>landing-next</button>,
}));

vi.mock('@/components/kiosk/StartScreen', () => ({
  default: ({ onStart }: any) => <button onClick={onStart}>start-next</button>,
}));

vi.mock('@/components/kiosk/LocationSelect', () => ({
  default: ({ onSelect }: any) => (
    <button onClick={() => onSelect('local')}>location-local</button>
  ),
}));

vi.mock('@/components/kiosk/LocalServiceSelect', () => ({
  default: ({ onBalcony }: any) => (
    <button onClick={onBalcony}>service-balcony</button>
  ),
}));

vi.mock('@/components/kiosk/TableSelect', () => ({ default: () => null }));
vi.mock('@/components/kiosk/AddressSelect', () => ({ default: () => null }));

vi.mock('@/components/kiosk/MenuScreen', () => ({
  default: () => <div>menu-screen</div>,
}));

vi.mock('@/components/kiosk/CartScreen', () => ({ default: () => null }));
vi.mock('@/components/kiosk/CheckoutScreen', () => ({ default: () => null }));
vi.mock('@/components/kiosk/PaymentScreen', () => ({ default: () => null }));
vi.mock('@/components/kiosk/TotemSuccess', () => ({ default: () => null }));
vi.mock('@/components/kiosk/NotificationBell', () => ({ default: () => null }));
vi.mock('@/components/kiosk/PartnersFooter', () => ({ default: () => null }));

import Index from '@/pages/Index';

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Index local-service QR concurrency', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    sessionStorage.clear();

    onAuthStateChangeMock.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    getSessionMock.mockResolvedValue({
      data: { session: null },
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

  it('does not let a late QR validation restore table context after choosing balcony', async () => {
    let resolveQr!: (value: any) => void;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'visionfood_public_table_context') {
        return new Promise(resolve => { resolveQr = resolve; });
      }
      return Promise.resolve({ data: null, error: null });
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/loja/demo?mesa=token-a']}>
          <Routes>
            <Route path="/loja/:slug" element={<Index />} />
          </Routes>
        </MemoryRouter>,
      );
      await flushAsync();
    });

    expect(rpcMock).toHaveBeenCalledWith('visionfood_public_table_context', {
      _organization_id: 'org-a',
      _table_token: 'token-a',
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

    expect(container.textContent).toContain('menu-screen');
    expect(container.textContent).not.toContain('Mesa 7');

    await act(async () => {
      resolveQr({
        data: { ok: true, label: 'Mesa 7' },
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('menu-screen');
    expect(container.textContent).not.toContain('Mesa 7');
  });
});
