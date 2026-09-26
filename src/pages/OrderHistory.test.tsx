// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  onAuthStateChangeMock,
  signOutMock,
  rpcMock,
  channelMock,
  removeChannelMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  signOutMock: vi.fn(),
  rpcMock: vi.fn(),
  channelMock: vi.fn(),
  removeChannelMock: vi.fn(),
}));

vi.mock('@/config/supabaseConfig', () => ({
  SUPABASE_AUTH_STORAGE_KEY: 'vision-test-auth',
}));

vi.mock('@/lib/kioskHome', () => ({
  getKioskHomePath: () => '/loja/demo',
}));

vi.mock('@/contexts/OrgContext', () => ({
  useOrgId: () => null,
}));

vi.mock('@/components/kiosk/LoyaltyCard', () => ({
  default: () => null,
}));

vi.mock('@/data/store', () => ({
  formatCurrency: (value: number) => `R$ ${Number(value).toFixed(2)}`,
}));

vi.mock('sonner', () => ({
  toast: {
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
    rpc: rpcMock,
    channel: channelMock,
    removeChannel: removeChannelMock,
  },
}));

import OrderHistory from '@/pages/OrderHistory';

const order = {
  id: '11111111-1111-1111-1111-111111111111',
  order_number: '42',
  total: 25,
  status: 'pending',
  created_at: '2026-09-22T12:00:00.000Z',
  items: [],
  order_type: 'pdv',
  customer_cpf: '',
  nfe_url: null,
  delivery_code: null,
  loyalty_points_awarded: 0,
  loyalty_points_reversed: false,
};

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('OrderHistory', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    localStorage.setItem('vision-test-auth', 'persisted-session');

    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });
    onAuthStateChangeMock.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    signOutMock.mockResolvedValue({ error: null });

    channelMock.mockImplementation(() => {
      const channel = {
        on: vi.fn(),
        subscribe: vi.fn(),
      };
      channel.on.mockReturnValue(channel);
      channel.subscribe.mockReturnValue(channel);
      return channel;
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('shows the real PDV order type and exposes the authorized internal receipt even without CPF', async () => {
    rpcMock.mockResolvedValue({ data: [order], error: null });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/meus-pedidos']}>
          <Routes>
            <Route path="/meus-pedidos" element={<OrderHistory />} />
            <Route path="/auth" element={<div>AUTH</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await flushAsync();
    });

    expect(container.textContent).toContain('PDV');
    expect(container.textContent).toContain('Ver comprovante do pedido');
    expect(container.textContent).not.toContain('Baixar Nota Fiscal');

    const receipt = Array.from(container.querySelectorAll('a'))
      .find((link) => link.textContent?.includes('Ver comprovante do pedido'));
    expect(receipt?.getAttribute('href')).toBe('/fiscal/11111111-1111-1111-1111-111111111111');

    await act(async () => root.unmount());
    container.remove();
  });

  it('identifies a scheduled order, shows its scheduled date/time, and links to tracking', async () => {
    const scheduledFor = '2026-09-27T18:30:00.000Z';
    const scheduledOrder = { ...order, scheduled_for: scheduledFor };
    rpcMock.mockResolvedValue({ data: [scheduledOrder], error: null });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/meus-pedidos']}>
          <Routes>
            <Route path="/meus-pedidos" element={<OrderHistory />} />
            <Route path="/auth" element={<div>AUTH</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await flushAsync();
    });

    const expectedScheduledDate = new Date(scheduledFor).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    expect(container.textContent).toContain('Agendado para');
    expect(container.textContent).toContain(expectedScheduledDate);

    const trackingLink = Array.from(container.querySelectorAll('a'))
      .find((link) => link.textContent?.includes('Acompanhar pedido'));
    expect(trackingLink?.getAttribute('href')).toBe('/acompanhar/11111111-1111-1111-1111-111111111111');

    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps the last successful order list visible when a background refresh fails', async () => {
    vi.useFakeTimers();
    rpcMock
      .mockResolvedValueOnce({ data: [order], error: null })
      .mockRejectedValueOnce(new Error('network unavailable'));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/meus-pedidos']}>
          <Routes>
            <Route path="/meus-pedidos" element={<OrderHistory />} />
            <Route path="/auth" element={<div>AUTH</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await flushAsync();
    });

    expect(container.textContent).toContain('#42');
    expect(container.textContent).not.toContain('Não foi possível carregar seus pedidos');

    await act(async () => {
      vi.advanceTimersByTime(15000);
      await flushAsync();
    });

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('#42');
    expect(container.textContent).not.toContain('Não foi possível carregar seus pedidos');

    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('prevents two logout events in the same turn from starting concurrent sign-outs', async () => {
    rpcMock.mockResolvedValue({ data: [order], error: null });
    signOutMock.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/meus-pedidos']}>
          <Routes>
            <Route path="/meus-pedidos" element={<OrderHistory />} />
            <Route path="/auth" element={<div>AUTH</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await flushAsync();
    });

    const logoutButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Sair'));

    expect(logoutButton).toBeTruthy();

    await act(async () => {
      logoutButton!.click();
      logoutButton!.click();
      await Promise.resolve();
    });

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });

    await act(async () => root.unmount());
    container.remove();
  });

});
