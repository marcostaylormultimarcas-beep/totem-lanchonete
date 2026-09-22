// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rpcMock,
  toastErrorMock,
  toastSuccessMock,
  toastInfoMock,
  removeChannelMock,
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastInfoMock: vi.fn(),
  removeChannelMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: rpcMock,
    removeChannel: removeChannelMock,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    info: toastInfoMock,
  },
}));

vi.mock('@/data/store', () => ({
  formatCurrency: (value: number) => `R$ ${Number(value).toFixed(2)}`,
}));

vi.mock('@/components/LiveDeliveryMap', () => ({
  default: () => null,
}));

vi.mock('@/lib/cep', () => ({
  geocodeAddress: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/deliveryRouting', () => ({
  googleMapsDirectionsUrl: () => 'https://maps.example/directions',
  MAX_DRIVER_CONFIRM_ACCURACY_M: 100,
  MAX_EXACT_DESTINATION_ACCURACY_M: 100,
}));

import EntregadorDashboard from '@/pages/EntregadorDashboard';

const session = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Motorista',
  username: 'motorista',
  organization_id: '22222222-2222-2222-2222-222222222222',
  org_slug: 'loja-a',
  org_name: 'Loja A',
  session_token: 'a'.repeat(64),
  expires_at: '2099-01-01T00:00:00.000Z',
};

const makeOrder = (status: string) => ({
  id: '33333333-3333-3333-3333-333333333333',
  order_number: '42',
  customer_name: 'Cliente',
  customer_phone: '62999999999',
  delivery_address: 'Rua Teste, 123',
  delivery_reference: null,
  delivery_recipient: null,
  items: [{ name: 'Produto', quantity: 1 }],
  total: 25,
  status,
  created_at: '2026-09-22T12:00:00.000Z',
  scheduled_for: null,
  bairro_nome: 'Centro',
  delivery_lat: null,
  delivery_lng: null,
  delivery_accuracy_m: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function renderDashboard(root: Root) {
  root.render(
    <MemoryRouter initialEntries={['/entregador']}>
      <Routes>
        <Route path="/entregador" element={<EntregadorDashboard />} />
        <Route path="/entregador/login" element={<div>LOGIN ENTREGADOR</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EntregadorDashboard assigned orders polling', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('entregador_session', JSON.stringify(session));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('shows a recoverable load error instead of a false empty-order state when the initial request fails', async () => {
    let ordersCalls = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        if (ordersCalls === 1) return Promise.reject(new Error('network unavailable'));
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('preparing')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    expect(container.textContent).toContain('Não foi possível carregar seus pedidos');
    expect(container.textContent).toContain('Tentar novamente');
    expect(container.textContent).not.toContain('Nenhum pedido atribuído no momento.');

    const retry = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Tentar novamente'));

    await act(async () => {
      retry?.click();
      await flushAsync();
    });

    expect(container.textContent).toContain('#42');
    expect(container.textContent).toContain('Preparando');
    expect(container.textContent).not.toContain('Não foi possível carregar seus pedidos');

    await act(async () => root.unmount());
    container.remove();
  });

  it('ignores an older refresh response that arrives after a newer assigned-order snapshot', async () => {
    const older = deferred<any>();
    const newer = deferred<any>();
    let ordersCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        if (ordersCalls === 1) {
          return Promise.resolve({ data: { ok: true, orders: [makeOrder('preparing')] }, error: null });
        }
        if (ordersCalls === 2) return older.promise;
        if (ordersCalls === 3) return newer.promise;
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('ready')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    expect(container.textContent).toContain('Preparando');

    const refresh = container.querySelector<HTMLButtonElement>('button[title="Atualizar"]');
    expect(refresh).toBeTruthy();

    await act(async () => {
      refresh?.click();
      refresh?.click();
      await Promise.resolve();
    });

    await act(async () => {
      newer.resolve({ data: { ok: true, orders: [makeOrder('ready')] }, error: null });
      await flushAsync();
    });

    expect(container.textContent).toContain('Pronto p/ retirar');

    await act(async () => {
      older.resolve({ data: { ok: true, orders: [makeOrder('preparing')] }, error: null });
      await flushAsync();
    });

    expect(container.textContent).toContain('Pronto p/ retirar');
    expect(container.textContent).not.toContain('Pedido ainda em preparo');

    await act(async () => root.unmount());
    container.remove();
  });
});
